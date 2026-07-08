-- ============================================================================
-- KONSI JURÍDICO — EXCLUSÃO DE CONTESTAÇÃO (08/07/2026)
-- ============================================================================
-- Permite HARD DELETE de contestações, restrito a usuários privilegiados
-- (Diretor, Coordenador e PM — NÃO a operação do dia a dia). Controle real
-- no banco via RLS, não só no front.
-- ============================================================================

-- 1. Flag de permissão no perfil (default false = ninguém exclui, salvo marcado)
alter table usuarios_perfil add column if not exists pode_excluir boolean not null default false;
comment on column usuarios_perfil.pode_excluir is
  'TRUE permite hard delete de contestações (RLS). Restrito a Diretor/Coordenador/PM.';

-- 2. Concede a permissão aos 3 autorizados (por e-mail → id do Auth)
update usuarios_perfil set pode_excluir = true
where id in (
  select id from auth.users
  where email in ('rafaelseixas@konsi.com.br', 'joaocarvalho@konsi.com.br', 'wilquerbosque@konsi.com.br')
);

-- 3. Policy de DELETE: só quem tem pode_excluir=true consegue apagar.
--    (Substitui a antiga decisão de "ninguém deleta".) A verificação roda
--    no banco, então a chave anon no front NÃO contorna isso.
drop policy if exists "Exclusão de contestações por usuários privilegiados" on contestacoes;
create policy "Exclusão de contestações por usuários privilegiados"
  on contestacoes for delete
  to authenticated
  using (exists (
    select 1 from usuarios_perfil p
    where p.id = auth.uid() and p.pode_excluir
  ));
