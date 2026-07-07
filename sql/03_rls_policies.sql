-- ============================================================================
-- KONSI JURÍDICO — ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- RLS é o motivo pelo qual é seguro o front-end (GitHub Pages, público)
-- falar DIRETO com o banco usando uma chave "anon" (anônima/pública).
--
-- Sem RLS: qualquer pessoa com a chave anon (que fica visível no código
-- JavaScript do navegador) poderia ler ou apagar QUALQUER linha de
-- QUALQUER tabela.
--
-- Com RLS: cada tabela fica BLOQUEADA por padrão. Só é possível ler/
-- escrever se existir uma "política" explícita permitindo aquela ação
-- para aquele usuário. É como um porteiro que checa a lista de convidados
-- antes de deixar qualquer operação acontecer, linha por linha.
--
-- Regra geral aplicada aqui: SOMENTE usuários autenticados (que fizeram
-- login pelo Supabase Auth) podem ler ou escrever. Visitantes anônimos
-- não autenticados não enxergam nada.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- ----------------------------------------------------------------------------
-- A partir daqui, por padrão, NINGUÉM consegue ler ou escrever — até
-- criarmos as políticas (policies) abaixo liberando casos específicos.
alter table contestacoes enable row level security;
alter table historico_importado enable row level security;
alter table logs_auditoria enable row level security;
alter table usuarios_perfil enable row level security;


-- ----------------------------------------------------------------------------
-- POLÍTICAS: contestacoes
-- ----------------------------------------------------------------------------

-- Qualquer usuário autenticado (logado) pode LER todas as contestações.
-- Faz sentido porque os 3 usuários (Rafael, Wilquer, Juliana) trabalham
-- no mesmo conjunto de casos, sem segregação por "dono do caso".
create policy "Usuários autenticados podem ler contestações"
  on contestacoes for select
  to authenticated
  using (true);

-- Qualquer usuário autenticado pode CRIAR uma nova contestação.
create policy "Usuários autenticados podem criar contestações"
  on contestacoes for insert
  to authenticated
  with check (true);

-- Qualquer usuário autenticado pode ATUALIZAR contestações existentes
-- (necessário porque o fluxo de 6 etapas vai editando o MESMO registro
-- conforme avança, não cria um novo a cada etapa).
create policy "Usuários autenticados podem atualizar contestações"
  on contestacoes for update
  to authenticated
  using (true)
  with check (true);

-- Ninguém pode DELETAR contestações pelo front-end — isso é proposital.
-- Em compliance jurídico, registros não devem desaparecer; se um caso
-- foi aberto por engano, o correto é marcar/anotar, não apagar o rastro.
-- (Não criamos política de DELETE, então fica bloqueado por padrão.)


-- ----------------------------------------------------------------------------
-- POLÍTICAS: historico_importado
-- ----------------------------------------------------------------------------
-- Leitura liberada para autenticados (necessário para dashboard/relatórios).
create policy "Usuários autenticados podem ler histórico"
  on historico_importado for select
  to authenticated
  using (true);

-- Inserção liberada para autenticados (a importação da planilha roda como
-- o próprio usuário logado, então precisa de permissão de insert).
create policy "Usuários autenticados podem importar histórico"
  on historico_importado for insert
  to authenticated
  with check (true);

-- Sem política de UPDATE/DELETE: histórico importado é "congelado" depois
-- de inserido, evitando que alguém edite um dado histórico por engano.


-- ----------------------------------------------------------------------------
-- POLÍTICAS: logs_auditoria
-- ----------------------------------------------------------------------------
-- Leitura liberada para autenticados (qualquer um dos 3 pode auditar).
create policy "Usuários autenticados podem ler logs"
  on logs_auditoria for select
  to authenticated
  using (true);

-- Inserção liberada (o próprio sistema grava logs em nome do usuário logado).
create policy "Usuários autenticados podem criar logs"
  on logs_auditoria for insert
  to authenticated
  with check (true);

-- Logs NUNCA podem ser editados ou apagados por ninguém pelo front-end —
-- isso é o que torna a auditoria confiável. (Sem políticas de
-- UPDATE/DELETE = bloqueado.)


-- ----------------------------------------------------------------------------
-- POLÍTICAS: usuarios_perfil
-- ----------------------------------------------------------------------------
-- Cada usuário pode ler o PRÓPRIO perfil...
create policy "Usuário lê o próprio perfil"
  on usuarios_perfil for select
  to authenticated
  using (auth.uid() = id);

-- ...mas também liberamos leitura de TODOS os perfis para autenticados,
-- porque o sistema mostra "Wilquer Bosque · Coordenador Jurídico" na
-- topbar e precisa exibir nome/cargo de quem registrou cada contestação
-- nos logs e relatórios.
create policy "Usuários autenticados podem ler todos os perfis"
  on usuarios_perfil for select
  to authenticated
  using (true);

-- Um usuário só pode atualizar o PRÓPRIO perfil (ex: trocar nome de exibição).
create policy "Usuário atualiza o próprio perfil"
  on usuarios_perfil for update
  to authenticated
  using (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- TRIGGER: criar perfil automaticamente após cadastro no Supabase Auth
-- ----------------------------------------------------------------------------
-- Quando um novo usuário é criado em auth.users (pela tela de convite do
-- Supabase, por exemplo), este trigger cria automaticamente a linha
-- correspondente em usuarios_perfil, evitando o passo manual de inserir
-- nas duas tabelas separadamente.
--
-- O nome e cargo iniciais vêm dos "metadados" (raw_user_meta_data) que
-- devem ser informados no momento da criação do usuário — ver README
-- para o passo a passo exato de como criar os 3 usuários iniciais.
create or replace function criar_perfil_usuario()
returns trigger as $$
begin
  insert into usuarios_perfil (id, nome_completo, cargo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome_completo', new.email),
    coalesce(new.raw_user_meta_data->>'cargo', 'Não definido')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_criar_perfil_usuario
  after insert on auth.users
  for each row
  execute function criar_perfil_usuario();


-- ----------------------------------------------------------------------------
-- SEGURANÇA: revogar acesso do papel "anon" ao schema public
-- ----------------------------------------------------------------------------
-- O sistema NUNCA consulta dados sem login (a chave anônima só serve para o
-- endpoint de autenticação). Revogar o SELECT do anon é cinto-e-suspensório
-- por cima do RLS + security_invoker: visitante sem login recebe 401 em
-- qualquer tabela ou view, em vez de respostas vazias.
-- (Adicionado na verificação do gate em 07/07/2026.)
revoke all on all tables in schema public from anon;
revoke usage on schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
