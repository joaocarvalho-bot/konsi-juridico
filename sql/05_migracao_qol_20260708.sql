-- ============================================================================
-- KONSI JURÍDICO — MIGRAÇÃO QoL (08/07/2026)
-- ============================================================================
-- Ajustes pedidos após o sistema entrar em produção:
--   1. Nova coluna `data_pagamento` (às vezes só se conhece a data do
--      pagamento, não a da celebração da operação).
--   2. Responsável: adicionar "Konsi e Banco", remover "SEGREDO DE JUSTIÇA".
--   3. Nível de risco: remover "SEGREDO DE JUSTIÇA".
--
-- Postgres não permite remover valor de enum diretamente; como a base está
-- sem registros, recriamos os dois tipos. As 10 views dependem (via cast) da
-- coluna, então são derrubadas em cascata e recriadas rodando 02_views.sql
-- logo em seguida (feito pelo script Python que aplica esta migração).
-- Tudo dentro de uma transação — ou aplica inteiro, ou nada.
-- ============================================================================

begin;

-- 1. Nova coluna
alter table contestacoes add column if not exists data_pagamento date;
comment on column contestacoes.data_pagamento is
  'Data em que a operação foi efetivamente paga (pode diferir da data de celebração/finalização).';

-- 2+3. Recriar os enums sem "SEGREDO DE JUSTIÇA" e com "Konsi e Banco"
--      (derruba as views dependentes; recriadas por 02_views.sql após o commit)
drop view if exists vw_contestacoes_consolidado cascade;

alter table contestacoes alter column responsavel type text using responsavel::text;
alter table contestacoes alter column nivel_risco type text using nivel_risco::text;

drop type responsavel_contestacao;
drop type nivel_risco;

create type responsavel_contestacao as enum ('Konsi', 'Banco', 'Konsi e Banco');
create type nivel_risco as enum ('Baixo', 'Médio', 'Alto');

alter table contestacoes alter column responsavel type responsavel_contestacao using responsavel::responsavel_contestacao;
alter table contestacoes alter column nivel_risco type nivel_risco using nivel_risco::nivel_risco;

commit;

-- Após este arquivo, reaplicar 02_views.sql (recria as 10 views + security_invoker)
-- e o bloco de revoke do anon de 03_rls_policies.sql (idempotente).
