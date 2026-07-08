// ============================================================================
// KONSI JURÍDICO — EDGE FUNCTION: sync-drive-sheets
// ============================================================================
// Esta função roda quando o advogado clica em "Exportar para o Sheets" ou
// quando uma contestação é finalizada e precisa:
//   1. Criar a pasta do cliente no Google Drive (padrão "NOME - CPF")
//   2. Salvar o laudo dentro dessa pasta
//   3. Salvar o arquivo de evidência (se houver)
//   4. Adicionar uma linha na planilha de controle do Google Sheets
//
// POR QUE ISSO PRECISA SER UMA EDGE FUNCTION E NÃO RODAR NO NAVEGADOR:
// Acessar a API do Google Drive/Sheets exige credenciais OAuth2 (client
// secret + refresh token) que dão acesso de escrita ao Drive da Konsi —
// jamais podem ficar visíveis no código do front-end público.
//
// NOTA (06/07/2026): a autenticação usa OAuth2 com refresh token de um
// usuário real, e NÃO Service Account, porque a política da organização
// Google da Konsi (iam.managed.disableServiceAccountKeyCreation) bloqueia
// a criação de chaves JSON de service account. O refresh token é obtido
// uma única vez com o consentimento do usuário e fica guardado nos
// secrets do Supabase.
//
// LEMBRETE IMPORTANTE: conforme decidido, o BANCO DE DADOS (Supabase) é
// a fonte de verdade. Esta sincronização é "sob demanda" — ou seja, o
// Sheets/Drive são uma CÓPIA exportada, não o lugar de onde o sistema lê
// os dados no dia a dia.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Credenciais OAuth2 do Google (client "Desktop" + refresh token do usuário
// autorizado), salvas como secrets no Supabase — ver README.
const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;
const GOOGLE_OAUTH_REFRESH_TOKEN = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN')!;
const GOOGLE_SHEET_ID = Deno.env.get('GOOGLE_SHEET_ID')!;       // planilha de controle
const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID')!; // pasta raiz no Drive

// Troca o refresh token (de longa duração) por um access token (~1h),
// a cada execução. O refresh token só é invalidado se o usuário revogar
// o acesso em https://myaccount.google.com/permissions.
async function obterAccessTokenGoogle(): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    throw new Error('Falha ao renovar access token Google: ' + (await resp.text()));
  }
  const data = await resp.json();
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const { contestacaoId } = await req.json();
    if (!contestacaoId) return jsonResponse({ erro: 'contestacaoId é obrigatório' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: c, error } = await supabase
      .from('contestacoes')
      .select('*')
      .eq('id', contestacaoId)
      .single();

    if (error || !c) return jsonResponse({ erro: 'Contestação não encontrada' }, 404);

    // ── Autentica com o Google via OAuth2 (refresh token → access token) ──
    const accessToken = await obterAccessTokenGoogle();

    const resultado: Record<string, unknown> = {};

    // ── 1. Cria a pasta do cliente no Drive (ou reaproveita se já existe) ──
    const nomePasta = `${c.nome_cliente.toUpperCase()} - ${c.cpf.replace(/\D/g, '')}`;

    const buscaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=` +
      encodeURIComponent(`name='${nomePasta}' and '${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const buscaData = await buscaResp.json();

    let pastaId: string;
    if (buscaData.files && buscaData.files.length > 0) {
      pastaId = buscaData.files[0].id;
    } else {
      const criaResp = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: nomePasta,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [GOOGLE_DRIVE_FOLDER_ID],
        }),
      });
      const criaData = await criaResp.json();
      pastaId = criaData.id;
    }
    resultado.pastaId = pastaId;
    resultado.pastaUrl = `https://drive.google.com/drive/folders/${pastaId}`;

    // ── 2. Salva o laudo como arquivo de texto dentro da pasta ──────────
    if (c.laudo_texto) {
      const nomeArquivo = `LAUDO_${c.ade || 'SEM_ADE'}_${c.cpf.replace(/\D/g, '')}.txt`;
      const conteudo =
        `KONSI — COMPLIANCE JURÍDICO\nRESPOSTA À CONTESTAÇÃO DE OPERAÇÕES\n${'='.repeat(60)}\n\n` +
        `Cliente: ${c.nome_cliente}\nCPF: ${c.cpf}\nBanco: ${c.banco}\nADE: ${c.ade}\n\n` +
        `${'='.repeat(60)}\n\n${c.laudo_texto}`;

      const boundary = 'konsi_boundary_' + Date.now();
      const multipartBody =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: nomeArquivo, parents: [pastaId] }) +
        `\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n` +
        conteudo +
        `\r\n--${boundary}--`;

      const arquivoResp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );
      const arquivoData = await arquivoResp.json();
      resultado.laudoUrl = `https://drive.google.com/file/d/${arquivoData.id}/view`;
    }

    // ── 2b. Copia o arquivo de evidência (Supabase Storage → Drive) ──────
    // arquivo_evidencia_url guarda o CAMINHO no bucket "evidencias" quando o
    // arquivo foi enviado por upload; se for um link externo (http...), pula.
    if (c.arquivo_evidencia_url && !/^https?:\/\//i.test(c.arquivo_evidencia_url)) {
      const caminho = c.arquivo_evidencia_url as string;
      const { data: blob, error: dlErr } = await supabase
        .storage.from('evidencias').download(caminho);
      if (!dlErr && blob) {
        const nomeEvid = caminho.split('/').pop() || 'evidencia';
        const mime = blob.type || 'application/octet-stream';
        const boundaryE = 'konsi_evid_' + Date.now();
        const enc = new TextEncoder();
        const pre = enc.encode(
          `--${boundaryE}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify({ name: nomeEvid, parents: [pastaId] }) +
          `\r\n--${boundaryE}\r\nContent-Type: ${mime}\r\n\r\n`
        );
        const post = enc.encode(`\r\n--${boundaryE}--`);
        const corpo = new Blob([pre, new Uint8Array(await blob.arrayBuffer()), post]);
        const evidResp = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundaryE}`,
            },
            body: corpo,
          }
        );
        const evidData = await evidResp.json();
        if (evidData.id) resultado.evidenciaUrl = `https://drive.google.com/file/d/${evidData.id}/view`;
      }
    }

    // ── 3. Adiciona linha na planilha de controle (Google Sheets) ──────
    const linha = [
      c.nome_cliente, c.cpf, c.convenio, c.operacao, c.banco, c.ade,
      formatarData(c.data_finalizacao_proposta),
      formatarData(c.data_recebimento),
      formatarData(c.data_resposta),
      c.motivo, c.status, c.protocolo_envio, c.canal, c.responsavel,
      c.nivel_risco, c.lista_restricao, c.observacao_interna,
      c.link_konsigleads || '', resultado.pastaUrl, resultado.laudoUrl || '',
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/Controle!A:T:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [linha] }),
      }
    );

    // ── Atualiza a contestação com os links gerados ──────────────────────
    await supabase
      .from('contestacoes')
      .update({
        link_pasta_drive: resultado.pastaUrl,
        link_laudo_drive: resultado.laudoUrl || null,
      })
      .eq('id', contestacaoId);

    await supabase.from('logs_auditoria').insert({
      acao: 'SYNC_DRIVE_SHEETS',
      detalhe: `Sincronizado com Drive/Sheets: pasta ${resultado.pastaUrl}`,
      contestacao_id: contestacaoId,
    });

    return jsonResponse({ ok: true, ...resultado });

  } catch (err) {
    return jsonResponse({ erro: String(err) }, 500);
  }
});

function formatarData(d: string | null): string {
  if (!d) return '';
  const [ano, mes, dia] = d.split('-');
  return `${dia}/${mes}/${ano}`;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
