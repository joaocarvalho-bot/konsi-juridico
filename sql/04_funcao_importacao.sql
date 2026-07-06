-- ============================================================================
-- KONSI JURÍDICO — FUNÇÃO DE IMPORTAÇÃO DE HISTÓRICO
-- ============================================================================
-- Esta função recebe um array JSON (gerado pelo front-end a partir do
-- arquivo .xlsx que o usuário sobe na tela de importação) e insere os
-- registros na tabela historico_importado, com tratamento de qualidade
-- de dados.
--
-- Por que tratar qualidade de dados AQUI (no banco) em vez de confiar
-- que o front-end já mandou tudo limpo?
--   Porque o front-end pode mudar, pode ter um bug, ou um dia alguém pode
--   chamar essa função diretamente (via API) sem passar pela tela. O
--   banco é a última linha de defesa contra dado corrompido entrando no
--   sistema — especialmente importante depois de termos encontrado uma
--   data com ano "0206" na planilha original.
-- ============================================================================

create or replace function importar_historico_contestacoes(
  registros jsonb,           -- array de objetos, um por linha da planilha
  usuario_importador uuid    -- quem está rodando a importação
)
returns table (
  total_recebidos integer,
  total_importados integer,
  total_com_avisos integer,
  lote_id uuid
) as $$
declare
  v_lote_id uuid := uuid_generate_v4();
  v_registro jsonb;
  v_total_recebidos integer := 0;
  v_total_importados integer := 0;
  v_total_avisos integer := 0;

  -- variáveis de trabalho para validar cada data antes de inserir
  v_data_finalizacao date;
  v_data_recebimento date;
  v_data_resposta date;
  v_avisos text;
begin
  -- Percorre cada objeto do array JSON recebido, um de cada vez
  for v_registro in select * from jsonb_array_elements(registros)
  loop
    v_total_recebidos := v_total_recebidos + 1;
    v_avisos := null;

    -- ── Validação de datas ────────────────────────────────────────────
    -- Tenta converter o texto da data para o tipo DATE do Postgres.
    -- Se a conversão falhar (texto inválido) OU o ano estiver fora de
    -- um intervalo plausível (1990-2100), a data é descartada (vira
    -- NULL) e registramos um aviso, em vez de travar a importação
    -- inteira por causa de uma linha problemática.
    begin
      v_data_finalizacao := (v_registro->>'dataFinalizacao')::date;
      if v_data_finalizacao is not null and
         (extract(year from v_data_finalizacao) < 1990 or
          extract(year from v_data_finalizacao) > 2100) then
        v_avisos := coalesce(v_avisos || '; ', '') || 'data_finalizacao fora do intervalo plausível, descartada';
        v_data_finalizacao := null;
      end if;
    exception when others then
      v_avisos := coalesce(v_avisos || '; ', '') || 'data_finalizacao inválida, descartada';
      v_data_finalizacao := null;
    end;

    begin
      v_data_recebimento := (v_registro->>'dataRecebimento')::date;
      if v_data_recebimento is not null and
         (extract(year from v_data_recebimento) < 1990 or
          extract(year from v_data_recebimento) > 2100) then
        v_avisos := coalesce(v_avisos || '; ', '') || 'data_recebimento fora do intervalo plausível, descartada';
        v_data_recebimento := null;
      end if;
    exception when others then
      v_avisos := coalesce(v_avisos || '; ', '') || 'data_recebimento inválida, descartada';
      v_data_recebimento := null;
    end;

    begin
      v_data_resposta := (v_registro->>'dataResposta')::date;
    exception when others then
      v_data_resposta := null;
    end;

    -- ── Validação de coerência: recebimento não pode ser ANTES da
    --    finalização da operação (indicaria dado corrompido) ──────────
    if v_data_finalizacao is not null and v_data_recebimento is not null
       and v_data_recebimento < v_data_finalizacao then
      v_avisos := coalesce(v_avisos || '; ', '') ||
        'data_recebimento anterior à finalização — mantido para registro, mas não entra no cálculo de tempo até contestação';
    end if;

    -- ── Insere o registro tratado ──────────────────────────────────────
    insert into historico_importado (
      nome_cliente, cpf, convenio, operacao, banco, ade,
      data_finalizacao_proposta, data_recebimento, data_resposta,
      motivo, status, protocolo, canal, responsavel, nivel_risco,
      situacao_evidencias, lista_restricao, observacao,
      importado_por, lote_importacao, observacao_qualidade_dados
    ) values (
      upper(trim(v_registro->>'nome')),
      v_registro->>'cpf',
      nullif(v_registro->>'convenio', ''),
      nullif(v_registro->>'operacao', ''),
      nullif(v_registro->>'banco', ''),
      nullif(v_registro->>'ade', ''),
      v_data_finalizacao,
      v_data_recebimento,
      v_data_resposta,
      nullif(v_registro->>'motivo', ''),
      nullif(v_registro->>'status', ''),
      nullif(v_registro->>'protocolo', ''),
      nullif(v_registro->>'canal', ''),
      nullif(v_registro->>'responsavel', ''),
      nullif(v_registro->>'risco', ''),
      nullif(v_registro->>'evidencias', ''),
      nullif(v_registro->>'listaRestricao', ''),
      nullif(v_registro->>'observacao', ''),
      usuario_importador,
      v_lote_id,
      v_avisos
    );

    v_total_importados := v_total_importados + 1;
    if v_avisos is not null then
      v_total_avisos := v_total_avisos + 1;
    end if;

  end loop;

  -- Registra a importação no log de auditoria
  insert into logs_auditoria (usuario_id, acao, detalhe)
  values (
    usuario_importador,
    'IMPORTACAO_HISTORICO',
    format('Importados %s de %s registros (lote %s), %s com avisos de qualidade de dados',
           v_total_importados, v_total_recebidos, v_lote_id, v_total_avisos)
  );

  return query select v_total_recebidos, v_total_importados, v_total_avisos, v_lote_id;
end;
$$ language plpgsql security definer;

comment on function importar_historico_contestacoes is
  'Importa em lote os registros da planilha histórica, validando e tratando datas corrompidas ou fora de intervalo plausível.';


-- ----------------------------------------------------------------------------
-- FUNÇÃO: desfazer_importacao
-- ----------------------------------------------------------------------------
-- Remove todos os registros de um lote de importação específico — útil
-- se a planilha foi subida errada ou duplicada por engano.
create or replace function desfazer_importacao(p_lote_id uuid, p_usuario uuid)
returns integer as $$
declare
  v_removidos integer;
begin
  delete from historico_importado where lote_importacao = p_lote_id;
  get diagnostics v_removidos = row_count;

  insert into logs_auditoria (usuario_id, acao, detalhe)
  values (p_usuario, 'IMPORTACAO_DESFEITA',
          format('Lote %s removido, %s registros excluídos', p_lote_id, v_removidos));

  return v_removidos;
end;
$$ language plpgsql security definer;
