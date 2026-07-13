// ============================================================================
// KONSI JURÍDICO — EDGE FUNCTION: preencher-laudo
// ============================================================================
// Gera o laudo PREENCHENDO um modelo .docx pré-aprovado pelo jurídico, em vez
// de redigir do zero. O modelo (11 tipos) vive no bucket 'modelos-laudo' com
// tags de merge no formato {campo}. Esta função:
//   1. carrega os dados da contestação (service_role);
//   2. escolhe o modelo (override do front ou mapa motivo/operação);
//   3. se o modelo tiver o slot {alegacoes_extra}, usa a IA (Haiku) para
//      sugerir um parágrafo — OU usa o texto que o advogado já revisou;
//   4. faz o merge determinístico no word/document.xml (JSZip);
//   5. sobe o .docx no bucket 'laudos' e devolve uma URL assinada.
//
// Dois modos:
//   { contestacaoId, modo:'sugerir', modelo }         -> { alegacoes, precisaAlegacoes }
//   { contestacaoId, modelo, alegacoesExtra }          -> gera o .docx e devolve { docxUrl, ... }
//
// A chave da Anthropic e a service_role ficam SÓ aqui (nunca no navegador).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'https://esm.sh/jszip@3.10.1';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const DOCX_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Modelos disponíveis (slug = nome do arquivo em modelos-laudo/<slug>.docx)
const MODELOS = new Set([
  'cancelamento', 'cartao_saque', 'desconhecimento_operacao',
  'exibicao_documentos', 'operacao_nao_realizada_corban',
  'portabilidade_refinanciamento', 'quitacao_antecipada', 'revisional_juros',
  'superendividamento', 'venda_casada', 'venda_casada_juros',
]);

// Único modelo que tem o slot narrativo {alegacoes_extra}.
const MODELOS_COM_ALEGACOES = new Set(['desconhecimento_operacao']);

// Sugestão de modelo a partir do motivo / operação (o front pode sobrescrever).
function sugerirModelo(motivo: string | null, operacao: string | null): string | null {
  const op = (operacao || '').toLowerCase();
  if (op.includes('cart')) return 'cartao_saque';
  if (op.includes('port') || op.includes('refin')) return 'portabilidade_refinanciamento';
  const m: Record<string, string> = {
    'NÃO RECONHECE': 'desconhecimento_operacao',
    'FRAUDE': 'operacao_nao_realizada_corban',
    'CANCELAMENTO': 'cancelamento',
    'DESACORDO COMERCIAL': 'quitacao_antecipada',
    'SUPERENDIVIDAMENTO': 'superendividamento',
    'REVISIONAL': 'revisional_juros',
    'EXIBICAO DOCUMENTO': 'exibicao_documentos',
    'VENDA CASADA': 'venda_casada',
  };
  return m[(motivo || '').toUpperCase()] || null;
}

function escXml(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function moeda(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hojeBR(): string {
  // data em fuso de Brasília
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return f.format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });

  try {
    const body = await req.json();
    const { contestacaoId, modo, alegacoesExtra } = body;
    let { modelo } = body;

    if (!contestacaoId) return json({ erro: 'contestacaoId é obrigatório' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // MODO URL: só devolve uma URL assinada nova para um .docx já gerado
    // (usado ao reabrir a contestação pelo histórico, sem regerar nada).
    if (modo === 'url') {
      const { data: signed, error: sErr } = await supabase
        .storage.from('laudos').createSignedUrl(`${contestacaoId}.docx`, 3600);
      if (sErr || !signed) return json({ erro: 'Laudo .docx ainda não foi gerado.' }, 404);
      return json({ ok: true, docxUrl: signed.signedUrl });
    }

    const { data: c, error } = await supabase
      .from('contestacoes').select('*').eq('id', contestacaoId).single();
    if (error || !c) return json({ erro: 'Contestação não encontrada' }, 404);

    // Regra: operação via app exige procedimento confirmado (igual gerar-laudo).
    if (c.operacao_via_app && !c.procedimento_app_confirmado) {
      return json({
        erro: 'Operação via app Konsi requer confirmação do procedimento de utilização do app antes de gerar o laudo.',
      }, 422);
    }

    // Resolve o modelo: override válido do front, senão mapa motivo/operação.
    if (!modelo || !MODELOS.has(modelo)) {
      modelo = sugerirModelo(c.motivo, c.operacao);
    }
    if (!modelo || !MODELOS.has(modelo)) {
      // Nenhum modelo aplicável — o front cai no fallback (gerar do zero via IA).
      return json({ semModelo: true, erro: 'Nenhum modelo aplicável a este motivo/operação.' }, 200);
    }

    const precisaAlegacoes = MODELOS_COM_ALEGACOES.has(modelo);

    // ── IA (Haiku): sugere o parágrafo de "demais alegações específicas" ──────
    async function gerarAlegacoes(): Promise<string> {
      const prompt = `Você é advogado de Compliance da Konsi (fintech de crédito consignado).
Com base APENAS nos fatos abaixo, redija UM ÚNICO parágrafo curto (2 a 4 frases, português jurídico, texto corrido, sem título e sem markdown) descrevendo eventuais ALEGAÇÕES ESPECÍFICAS ADICIONAIS feitas pelo reclamante, além da alegação genérica de que não reconhece a operação.
Se os fatos não trouxerem nenhuma alegação específica adicional, responda EXATAMENTE com um traço: "—".

FATOS ALEGADOS: ${c.descricao_fatos || '(não informado)'}
MOTIVO: ${c.motivo || '(não informado)'}`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) throw new Error('Falha na IA (Haiku): ' + (await r.text()));
      const d = await r.json();
      const t = d.content?.find((b: any) => b.type === 'text')?.text || '';
      return t.replace(/\s+/g, ' ').trim();
    }

    // MODO SUGERIR: só devolve a sugestão da IA para o advogado revisar.
    if (modo === 'sugerir') {
      const alegacoes = precisaAlegacoes ? await gerarAlegacoes() : '';
      return json({ ok: true, modelo, precisaAlegacoes, alegacoes });
    }

    // ── MODO GERAR: monta o .docx ─────────────────────────────────────────────
    let alegacoes = '';
    if (precisaAlegacoes) {
      alegacoes = (typeof alegacoesExtra === 'string' && alegacoesExtra.trim())
        ? alegacoesExtra.trim()
        : await gerarAlegacoes();
      if (alegacoes === '—') alegacoes = '';
    }

    // Baixa o modelo do Storage.
    const { data: tplBlob, error: dlErr } = await supabase
      .storage.from('modelos-laudo').download(`${modelo}.docx`);
    if (dlErr || !tplBlob) return json({ erro: 'Modelo não encontrado no Storage: ' + modelo }, 500);
    const tplBytes = new Uint8Array(await tplBlob.arrayBuffer());

    // Dados do merge (tags {campo} normalizadas no modelo).
    const dados: Record<string, string> = {
      nome: c.nome_cliente || '',
      cpf: c.cpf || '',
      banco: c.banco || '',
      contrato: c.ade || '',
      processo: c.numero_processo_judicial || '',
      convenio: c.convenio || '',
      operacao: c.operacao || '',
      valor: moeda(c.valor_liberado),
      valor_parcela: moeda(c.valor_parcela),
      qtd_parcelas: c.qtd_parcelas ? String(c.qtd_parcelas) : '',
      troco: '',
      data_resposta: hojeBR(),
      alegacoes_extra: alegacoes,
    };

    const zip = await JSZip.loadAsync(tplBytes);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) return json({ erro: 'Modelo .docx inválido (sem document.xml)' }, 500);
    let xml = await docXmlFile.async('string');

    for (const [k, v] of Object.entries(dados)) {
      xml = xml.split(`{${k}}`).join(escXml(v));
    }
    // Remove quaisquer tags {xxx} que sobraram (dado ausente) para não vazar no doc.
    xml = xml.replace(/\{[a-z_]+\}/g, '');

    zip.file('word/document.xml', xml);
    const outBytes: Uint8Array = await zip.generateAsync({ type: 'uint8array' });

    const path = `${contestacaoId}.docx`;
    const { error: upErr } = await supabase
      .storage.from('laudos').upload(path, outBytes, { contentType: DOCX_CT, upsert: true });
    if (upErr) return json({ erro: 'Falha ao salvar o .docx: ' + upErr.message }, 500);

    const { data: signed } = await supabase
      .storage.from('laudos').createSignedUrl(path, 3600);

    // Opção A/B do bloco condicional (interações com o cliente) que o advogado
    // deve manter no Word — derivada de "Possui conversas na mensageria?".
    const opcaoInteracao = c.tem_conversas_hyperflow === true ? 'A' : 'B';

    const nota = `Laudo gerado a partir do modelo aprovado "${modelo}" (.docx em anexo).`
      + (alegacoes ? `\n\nAlegações específicas: ${alegacoes}` : '');

    await supabase.from('contestacoes').update({
      laudo_modelo: modelo,
      laudo_docx_path: path,
      laudo_texto: nota,
      laudo_gerado_em: new Date().toISOString(),
      etapa_atual: '5_elaboracao',
    }).eq('id', contestacaoId);

    await supabase.from('logs_auditoria').insert({
      acao: 'LAUDO_GERADO',
      detalhe: `Laudo por modelo "${modelo}" para ${c.nome_cliente} (CPF ${c.cpf})`,
      contestacao_id: contestacaoId,
    });

    return json({
      ok: true,
      modelo,
      docxUrl: signed?.signedUrl || null,
      opcaoInteracao,
      alegacoes,
      nota,
    });
  } catch (err) {
    return json({ erro: String(err) }, 500);
  }
});

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}
