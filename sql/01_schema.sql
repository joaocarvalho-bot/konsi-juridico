-- ============================================================================
-- KONSI JURÍDICO — SCHEMA DO BANCO DE DADOS (Supabase / PostgreSQL)
-- ============================================================================
-- Como aplicar:
--   1. Crie o projeto em https://supabase.com
--   2. Vá em SQL Editor (menu lateral)
--   3. Cole todo este arquivo e clique em "Run"
--   4. Repita para os arquivos 02, 03, 04 NESTA ORDEM
-- ============================================================================


-- ----------------------------------------------------------------------------
-- EXTENSÕES NECESSÁRIAS
-- ----------------------------------------------------------------------------
-- uuid-ossp: gera IDs únicos (UUID) automaticamente para cada registro.
-- Usamos UUID em vez de números sequenciais (1, 2, 3...) porque:
--   (a) não revela quantas contestações existem só olhando o ID
--   (b) evita conflito se um dia precisarmos importar dados de outra fonte
create extension if not exists "uuid-ossp";


-- ----------------------------------------------------------------------------
-- TIPOS ENUMERADOS (ENUMs)
-- ----------------------------------------------------------------------------
-- Um ENUM é uma lista fechada de valores válidos para uma coluna.
-- Vantagem sobre texto livre: o banco RECUSA gravar "Finalizdo" (erro de
-- digitação) porque só aceita os valores exatos da lista. Isso garante que
-- o dashboard e os relatórios nunca vão "perder" um registro por causa de
-- inconsistência de grafia (problema comum na planilha Excel anterior).
--
-- Os valores abaixo foram extraídos da planilha real "Controle de
-- Contestações.xlsx" (331 registros históricos), garantindo que NENHUM
-- valor que já existe no histórico fique de fora.

create type status_contestacao as enum (
  'Pendente',       -- ainda não passou pela etapa de confirmação de envio
  'Em tratativa',   -- em andamento, aguardando alguma definição
  'Em aberto',      -- recebida mas não iniciada
  'Finalizado'      -- resposta enviada e confirmada
);

create type motivo_contestacao as enum (
  'NÃO RECONHECE',
  'FRAUDE',
  'CANCELAMENTO',
  'DESACORDO COMERCIAL',
  'SUPERENDIVIDAMENTO',
  'REVISIONAL',
  'EXIBICAO DOCUMENTO',
  'VENDA CASADA',
  'SEGREDO DE JUSTIÇA'
);

create type canal_contestacao as enum (
  'Judicial',
  'SAC Banco',
  'E-mail',
  'BACEN',
  'Procon',
  'Reclame Aqui',
  'Consumidor.gov',
  'Sistema Contest'
);

create type responsavel_contestacao as enum (
  'Konsi',
  'Banco',
  'Konsi e Banco'   -- responsabilidade compartilhada (add. QoL 08/07/2026)
);

create type nivel_risco as enum (
  'Baixo',
  'Médio',
  'Alto'
);

-- IMPORTANTE: na planilha antiga "Evidências" tinha 3 estados, não 2.
-- O sistema HTML anterior tratava como Sim/Não (binário), o que PERDIA
-- a informação de "Dispensa evidência" (ex: quando a operação foi via
-- app Konsi e o procedimento de uso do app substitui a evidência).
create type situacao_evidencias as enum (
  'Com evidências',
  'Sem evidências',
  'Dispensa evidência',  -- ex: operação via app, procedimento substitui
  'A definir'
);

create type etapa_fluxo as enum (
  '1_recepcao',     -- dados mínimos da notificação recebida
  '2_operacao',     -- dados completos da operação (para o laudo)
  '3_subsidios',    -- evidências, Hyperflow, procedimento do app
  '4_previa',       -- projeção textual do laudo sem IA
  '5_elaboracao',   -- laudo gerado pela IA
  '6_finalizado'    -- envio confirmado, registro completo
);


-- ----------------------------------------------------------------------------
-- TABELA: usuarios_perfil
-- ----------------------------------------------------------------------------
-- O Supabase Auth já cria e gerencia a tabela "auth.users" (e-mail, senha
-- hash, tokens de sessão) automaticamente — não mexemos nela diretamente.
-- Esta tabela complementa com dados específicos do nosso sistema (cargo,
-- nome de exibição), ligada 1-para-1 com auth.users pelo mesmo ID.
create table usuarios_perfil (
  id uuid primary key references auth.users(id) on delete cascade,
  nome_completo text not null,
  cargo text not null,
  ativo boolean not null default true,
  pode_excluir boolean not null default false,  -- permite hard delete de contestações (RLS)
  criado_em timestamptz not null default now()
);

comment on table usuarios_perfil is
  'Dados complementares de cada usuário do sistema jurídico, vinculados ao Supabase Auth.';


-- ----------------------------------------------------------------------------
-- TABELA: contestacoes
-- ----------------------------------------------------------------------------
-- Tabela central do sistema. Cada linha é UMA contestação em algum ponto
-- do fluxo de 6 etapas. Os campos são organizados em blocos que
-- correspondem exatamente às etapas do formulário no front-end.
create table contestacoes (
  id uuid primary key default uuid_generate_v4(),

  -- controle de fluxo
  etapa_atual etapa_fluxo not null default '1_recepcao',
  status status_contestacao not null default 'Pendente',
  criado_por uuid references usuarios_perfil(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- ── ETAPA 1: RECEPÇÃO (dados mínimos da notificação) ──────────────────
  -- nome_cliente é salvo SEMPRE em maiúsculo (ver trigger normalizar_nome
  -- mais abaixo) para manter consistência, já que a notificação pode
  -- chegar em qualquer formato de caixa.
  nome_cliente text not null,
  cpf text not null,
  ade text,                              -- nº do contrato/proposta
  banco text,
  motivo motivo_contestacao,
  canal canal_contestacao,
  data_recebimento date,

  -- ── ETAPA 2: DADOS DA OPERAÇÃO (essenciais para o laudo) ──────────────
  convenio text,
  operacao text,
  valor_liberado numeric(14,2),
  valor_parcela numeric(14,2),
  qtd_parcelas integer,
  data_finalizacao_proposta date,        -- quando a operação foi celebrada
  data_pagamento date,                   -- quando foi efetivamente paga (pode diferir da celebração)
  numero_processo_judicial text,
  responsavel responsavel_contestacao,
  nivel_risco nivel_risco,
  descricao_fatos text,
  observacao_interna text,

  -- ── ETAPA 3: SUBSÍDIOS ─────────────────────────────────────────────────
  situacao_evidencias situacao_evidencias,
  arquivo_evidencia_url text,            -- link do arquivo no Google Drive
  tem_conversas_hyperflow boolean,
  -- Regra de negócio nova: se a operação foi formalizada via app Konsi,
  -- é OBRIGATÓRIO confirmar que o procedimento de utilização do app será
  -- anexado ao laudo. Esse campo guarda a confirmação do checkbox.
  operacao_via_app boolean default false,
  procedimento_app_confirmado boolean default false,

  -- ── ETAPA 4/5: LAUDO ───────────────────────────────────────────────────
  laudo_texto text,
  laudo_gerado_em timestamptz,

  -- ── ETAPA 6: FINALIZAÇÃO ───────────────────────────────────────────────
  protocolo_envio text,
  data_resposta date,
  envio_confirmado boolean not null default false,
  advogado_responsavel text,
  lista_restricao text,

  -- ── INTEGRAÇÕES EXTERNAS ───────────────────────────────────────────────
  link_konsigleads text,
  link_pasta_drive text,
  link_laudo_drive text,

  -- ── ORIGEM DO REGISTRO ─────────────────────────────────────────────────
  -- Diferencia registros criados manualmente, via extensão Chrome, ou
  -- importados em massa da planilha histórica.
  origem_registro text not null default 'manual'
    check (origem_registro in ('manual', 'extensao_chrome', 'importacao_historico')),

  constraint cpf_formato check (cpf ~ '^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$')
);

comment on table contestacoes is
  'Registro central de cada contestação, do recebimento da notificação até a finalização do envio da resposta.';
comment on column contestacoes.nome_cliente is
  'Sempre armazenado em MAIÚSCULO via trigger, independente de como foi digitado.';
comment on column contestacoes.operacao_via_app is
  'TRUE quando a operação foi celebrada via aplicativo Konsi — ativa a exigência do checkbox de procedimento do app.';
comment on column contestacoes.origem_registro is
  'Rastreia se o registro veio de digitação manual, da extensão Chrome (Konsigleads) ou de importação em massa do histórico.';


-- ----------------------------------------------------------------------------
-- TRIGGER: normalizar nome do cliente para MAIÚSCULO
-- ----------------------------------------------------------------------------
-- Atende ao requisito: "nome completo, mas para a próxima etapa converter
-- automaticamente para maiúsculo". Fazemos isso no banco (não só no
-- front-end) para garantir que NENHUM caminho de entrada de dados
-- (extensão, importação, edição manual) escape dessa regra.
create or replace function normalizar_nome_cliente()
returns trigger as $$
begin
  new.nome_cliente := upper(trim(new.nome_cliente));
  new.atualizado_em := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_normalizar_nome
  before insert or update on contestacoes
  for each row
  execute function normalizar_nome_cliente();


-- ----------------------------------------------------------------------------
-- TABELA: historico_importado
-- ----------------------------------------------------------------------------
-- Guarda os 331 registros da planilha Excel antiga, importados em bloco.
-- Por que uma tabela SEPARADA de "contestacoes" e não misturada?
--   1. O histórico tem qualidade de dados diferente (datas corrompidas,
--      categorias que não existem mais, ausência de muitos campos novos
--      como ADE/processo judicial em registros antigos)
--   2. Mantém claro o que é "operação real do sistema novo" vs
--      "dado herdado para fins estatísticos/cohort"
--   3. Se um dia quisermos reprocessar ou descartar o histórico, não
--      arriscamos tocar nos dados operacionais atuais
-- O dashboard e os relatórios consultam as DUAS tabelas combinadas
-- (ver view vw_contestacoes_consolidado mais abaixo).
create table historico_importado (
  id uuid primary key default uuid_generate_v4(),
  nome_cliente text,
  cpf text,
  convenio text,
  operacao text,
  banco text,
  ade text,
  data_finalizacao_proposta date,
  data_recebimento date,
  data_resposta date,
  motivo text,           -- texto livre, não ENUM: histórico pode ter categorias antigas
  status text,
  protocolo text,
  canal text,
  responsavel text,
  nivel_risco text,
  situacao_evidencias text,
  lista_restricao text,
  observacao text,

  importado_em timestamptz not null default now(),
  importado_por uuid references usuarios_perfil(id),
  lote_importacao uuid not null,  -- agrupa registros da mesma importação (permite desfazer)

  -- Marca linhas com problema de qualidade de dados (ex: data corrompida
  -- "0206-05-19" encontrada na planilha original) para auditoria,
  -- em vez de simplesmente descartar a linha silenciosamente.
  observacao_qualidade_dados text
);

comment on table historico_importado is
  'Dados históricos importados da planilha Excel anterior, usados para cohort e estatísticas de longo prazo. Não participam do fluxo operacional atual.';
comment on column historico_importado.lote_importacao is
  'UUID comum a todos os registros de uma mesma importação — permite identificar e reverter uma importação inteira se necessário.';


-- ----------------------------------------------------------------------------
-- TABELA: logs_auditoria
-- ----------------------------------------------------------------------------
-- Substitui a antiga planilha Google Sheets "logs compliance". Cada ação
-- relevante do sistema gera uma linha aqui — login, logout, criação e
-- edição de contestação, geração de laudo, confirmação de envio.
create table logs_auditoria (
  id uuid primary key default uuid_generate_v4(),
  criado_em timestamptz not null default now(),
  usuario_id uuid references usuarios_perfil(id),
  usuario_nome text,           -- duplicado de propósito: preserva o nome
                                -- mesmo se o usuário for excluído depois
  acao text not null,          -- ex: 'LOGIN', 'CONTESTACAO_CRIADA', 'LAUDO_GERADO'
  detalhe text,
  contestacao_id uuid references contestacoes(id) on delete set null,
  ip_user_agent text,
  sessao_id text
);

comment on table logs_auditoria is
  'Trilha de auditoria de todas as ações relevantes do sistema, para fins de compliance.';

-- Índice para a consulta mais comum: "logs de uma contestação específica,
-- mais recentes primeiro"
create index idx_logs_contestacao on logs_auditoria(contestacao_id, criado_em desc);
create index idx_logs_usuario on logs_auditoria(usuario_id, criado_em desc);


-- ----------------------------------------------------------------------------
-- ÍNDICES DE PERFORMANCE
-- ----------------------------------------------------------------------------
-- Sem índice, toda consulta de relatório/dashboard percorre a tabela
-- inteira linha por linha. Com poucas centenas de registros isso nem
-- se nota, mas como o objetivo é crescer com gestão de processos por
-- anos, vale criar os índices desde já nas colunas mais filtradas.

create index idx_contestacoes_status on contestacoes(status);
create index idx_contestacoes_banco on contestacoes(banco);
create index idx_contestacoes_operacao on contestacoes(operacao);
create index idx_contestacoes_convenio on contestacoes(convenio);
create index idx_contestacoes_motivo on contestacoes(motivo);
create index idx_contestacoes_data_recebimento on contestacoes(data_recebimento);
create index idx_contestacoes_etapa on contestacoes(etapa_atual);
create index idx_contestacoes_cpf on contestacoes(cpf);

create index idx_historico_banco on historico_importado(banco);
create index idx_historico_operacao on historico_importado(operacao);
create index idx_historico_convenio on historico_importado(convenio);
create index idx_historico_data_finalizacao on historico_importado(data_finalizacao_proposta);
create index idx_historico_data_recebimento on historico_importado(data_recebimento);
