-- ============================================================================
-- KONSI JURÍDICO — MIGRAÇÃO 08: laudo por modelo .docx (13/07/2026)
-- ============================================================================
-- A partir desta versão, o laudo dos 11 tipos conhecidos de contestação é
-- gerado preenchendo um MODELO .docx pré-aprovado pelo jurídico (merge
-- determinístico dos dados), em vez de ser redigido do zero pela IA. A IA
-- (Haiku) entra só no parágrafo de "demais alegações específicas". O
-- gerar-do-zero (Sonnet) permanece como fallback para motivos fora da lista.
--
-- Duas colunas novas em contestacoes:
--   laudo_modelo    — slug do modelo usado (ex.: 'desconhecimento_operacao')
--   laudo_docx_path — caminho do .docx gerado no bucket 'laudos'
-- Ambas nullable: contestações antigas (laudo em texto) seguem válidas.
-- ============================================================================

alter table contestacoes add column if not exists laudo_modelo    text;
alter table contestacoes add column if not exists laudo_docx_path text;

comment on column contestacoes.laudo_modelo    is 'Slug do modelo .docx usado no laudo (null = laudo em texto / IA do zero)';
comment on column contestacoes.laudo_docx_path is 'Caminho do laudo .docx no Storage bucket laudos (ex.: <id>.docx)';
