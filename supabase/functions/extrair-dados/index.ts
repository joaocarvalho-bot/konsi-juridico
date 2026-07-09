// ============================================================================
// KONSI JURÍDICO — EDGE FUNCTION: extrair-dados  (auto-preenchimento por IA)
// ============================================================================
// Recebe uma notificação de contestação (e-mail em texto, PDF ou print) e
// devolve os campos das etapas 1 e 2 PRÉ-PREENCHIDOS, cada um com um nível de
// confiança (alta/media/vazio). NÃO grava nada: o advogado revisa no front e
// só então salva. A chave da Anthropic fica no servidor, nunca no browser.
//
// PIPELINE (2 fases, anti-overconfidence):
//   1. IA extrai + auto-avalia confiança (Haiku p/ e-mail, Sonnet p/ PDF/print).
//   2. Validadores determinísticos (CNJ mod 97 / CPF DV) rodam DEPOIS e podem
//      REBAIXAR a confiança + anexar flag — a IA nunca "decide" sozinha se um
//      número é processo judicial ou se um CPF fecha.
//
// COMO O FRONT CHAMA:
//   fetch('.../functions/v1/extrair-dados', {
//     method:'POST',
//     headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${accessToken}` },
//     body: JSON.stringify({ tipo:'email', texto:'...' })           // e-mail
//        // ou { tipo:'pdf',    arquivo_base64:'...' }               // PDF
//        // ou { tipo:'imagem', arquivo_base64:'...', mime:'image/png' } // print
//   })
// ============================================================================

import { SYSTEM_PROMPT } from './prompt.ts';
import { TOOL } from './schema.ts';
import { analisarCNJ, validarCPF } from './validadores.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

// e-mail = texto → modelo barato; PDF/imagem = visão → modelo com visão.
const MODELO_TEXTO = 'claude-haiku-4-5-20251001';
const MODELO_VISAO = 'claude-sonnet-5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  try {
    const body = await req.json().catch(() => ({}));
    const tipo = body?.tipo;
    if (!['email', 'pdf', 'imagem'].includes(tipo)) {
      return jsonResponse({ erro: "campo 'tipo' deve ser 'email', 'pdf' ou 'imagem'" }, 400);
    }

    // ── Monta o conteúdo multimodal + escolhe o modelo ──────────────────────
    let modelo: string;
    let userContent: any[];
    if (tipo === 'email') {
      if (!body.texto || typeof body.texto !== 'string') {
        return jsonResponse({ erro: "tipo 'email' requer o campo 'texto'" }, 400);
      }
      modelo = MODELO_TEXTO;
      userContent = [{ type: 'text', text: montarUser(tipo, body.banco, body.texto) }];
    } else {
      if (!body.arquivo_base64 || typeof body.arquivo_base64 !== 'string') {
        return jsonResponse({ erro: `tipo '${tipo}' requer o campo 'arquivo_base64'` }, 400);
      }
      modelo = MODELO_VISAO;
      const anexo = tipo === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.arquivo_base64 } }
        : { type: 'image', source: { type: 'base64', media_type: body.mime || 'image/png', data: body.arquivo_base64 } };
      userContent = [anexo, { type: 'text', text: montarUser(tipo, body.banco, null) }];
    }

    // ── Chama a Anthropic forçando a ferramenta estruturada ─────────────────
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!resp.ok) {
      const erro = await resp.text();
      return jsonResponse({ erro: 'Falha ao chamar a IA: ' + erro }, 502);
    }
    const data = await resp.json();
    // Truncamento silencioso é pior que erro: extração incompleta não pode
    // parecer completa para o revisor.
    if (data.stop_reason === 'max_tokens') {
      return jsonResponse({ erro: 'Extração truncada pelo limite de tokens — tente novamente.' }, 502);
    }
    const toolUse = (data.content || []).find(
      (b: any) => b.type === 'tool_use' && b.name === TOOL.name,
    );
    if (!toolUse?.input) {
      return jsonResponse({ erro: 'A IA não retornou a extração estruturada.' }, 502);
    }

    const extracao = toolUse.input as any;

    // ── Pós-processamento determinístico (2ª camada) ────────────────────────
    const validacao = posProcessar(extracao);

    return jsonResponse({
      ok: true,
      modelo,
      campos: extracao.campos ?? {},
      subsidios: extracao.subsidios ?? [],
      contratos_adicionais: extracao.contratos_adicionais ?? [],
      observacoes_extras: extracao.observacoes_extras ?? null,
      validacao,
    });
  } catch (err) {
    return jsonResponse({ erro: String(err) }, 500);
  }
});

// Monta a mensagem do usuário (o conteúdo do e-mail entra aqui; PDF/imagem vêm
// como bloco anexo e o texto só situa o modelo).
function montarUser(tipo: string, banco: string | undefined, texto: string | null): string {
  const cab = `Canal de entrada: ${tipo}\nBanco (se conhecido pelo remetente/config): ${banco || 'desconhecido'}`;
  if (texto) return `${cab}\n\n--- CONTEÚDO DA NOTIFICAÇÃO ---\n${texto}`;
  return `${cab}\n\nO conteúdo da notificação está no anexo (${tipo}). Extraia os dados dele.`;
}

// Roda CNJ (mod 97) e CPF (DV) sobre o que a IA extraiu; pode REBAIXAR a
// confiança e anexar flag. Nunca "conserta" o valor do CPF.
function posProcessar(extracao: any) {
  const campos = extracao?.campos ?? {};
  const flags: string[] = [];
  const rebaixar = (c: any) => { if (c && c.confianca === 'alta') c.confianca = 'media'; };

  // numero_processo → CNJ
  let cnj: any = null;
  const np = campos.numero_processo;
  if (np?.valor) {
    cnj = analisarCNJ(np.valor);
    np.flag_validador = cnj.classificacao;
    if (cnj.valido) {
      np.valor = cnj.formatado;          // máscara limpa
      np.uf = cnj.uf;
      np.tribunal = cnj.tribunal_sigla;
      if (cnj.ocr_corrigido) rebaixar(np); // corrigido por OCR → no máx. media
    } else {
      // Casa a máscara mas não é processo judicial válido, OU formato inválido.
      rebaixar(np);
      flags.push(`numero_processo: ${cnj.classificacao}${cnj.flags?.[0] ? ' — ' + cnj.flags[0] : ''}`);
    }
  }

  // cpf → dígito verificador
  let cpf: any = null;
  const cp = campos.cpf;
  if (cp?.valor) {
    cpf = validarCPF(cp.valor);
    cp.flag_validador = cpf.valido ? 'cpf_valido' : 'cpf_invalido';
    if (cpf.valido) {
      cp.valor = cpf.formatado;          // normaliza formatação (não corrige dígito)
    } else {
      rebaixar(cp);
      flags.push(`cpf: dígito verificador não fecha (${cpf.motivo}) — conferir manualmente`);
    }
  }

  return { cnj, cpf, flags };
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
