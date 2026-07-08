-- ============================================================================
-- KONSI JURÍDICO — STORAGE: bucket de evidências (08/07/2026)
-- ============================================================================
-- Upload de arquivos de evidência (etapa 3). Bucket PRIVADO (só quem está
-- logado acessa, via URL assinada). Qualquer tipo de arquivo, até 25 MB.
-- Na finalização, o sync-drive-sheets copia o arquivo pra pasta do Drive.
-- ============================================================================

-- 1. Bucket privado, limite 25 MB, sem restrição de mime-type
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 26214400, null)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      public = excluded.public,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. RLS: só usuários autenticados leem/gravam objetos deste bucket.
--    (anon não tem policy => sem acesso. Mesma postura do resto do sistema.)
drop policy if exists "evidencias_select_auth" on storage.objects;
drop policy if exists "evidencias_insert_auth" on storage.objects;
drop policy if exists "evidencias_update_auth" on storage.objects;
drop policy if exists "evidencias_delete_auth" on storage.objects;

create policy "evidencias_select_auth" on storage.objects
  for select to authenticated using (bucket_id = 'evidencias');
create policy "evidencias_insert_auth" on storage.objects
  for insert to authenticated with check (bucket_id = 'evidencias');
create policy "evidencias_update_auth" on storage.objects
  for update to authenticated using (bucket_id = 'evidencias') with check (bucket_id = 'evidencias');
create policy "evidencias_delete_auth" on storage.objects
  for delete to authenticated using (bucket_id = 'evidencias');
