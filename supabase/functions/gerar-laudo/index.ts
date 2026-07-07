// ============================================================================
// KONSI JURÍDICO — EDGE FUNCTION: gerar-laudo
// ============================================================================
// O QUE É UMA EDGE FUNCTION:
// É um pequeno programa que roda nos servidores do Supabase (não na sua
// máquina, não no navegador do usuário). Funciona como uma ponte segura
// entre o front-end público (GitHub Pages) e serviços externos que exigem
// uma chave secreta.
//
// POR QUE ISSO NÃO PODE SER FEITO DIRETO NO FRONT-END:
// A chave da API da Anthropic (ANTHROPIC_API_KEY) dá acesso a um serviço
// PAGO por uso. Se ela fosse colocada no código JavaScript que roda no
// GitHub Pages, QUALQUER pessoa que abrisse o site poderia ver a chave
// (basta inspecionar o código-fonte da página) e usá-la para gerar
// cobranças na conta da Konsi. A Edge Function mantém essa chave apenas
// no servidor, nunca exposta ao navegador.
//
// COMO O FRONT-END CHAMA ISSO:
//   const resp = await fetch(
//     'https://SEU-PROJETO.supabase.co/functions/v1/gerar-laudo',
//     {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `Bearer ${supabaseAnonKey}`
//       },
//       body: JSON.stringify({ contestacaoId: 'uuid-da-contestacao' })
//     }
//   );
//   const { laudo } = await resp.json();
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Variáveis de ambiente — configuradas no painel do Supabase, nunca
// hardcoded no código (ver README, seção "Configurar variáveis secretas").
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  // CORS: permite que o front-end no GitHub Pages chame esta função.
  // Sem isso, o navegador bloqueia a requisição por política de segurança.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const { contestacaoId } = await req.json();

    if (!contestacaoId) {
      return jsonResponse({ erro: 'contestacaoId é obrigatório' }, 400);
    }

    // Cliente Supabase com permissão TOTAL (service_role) — só existe
    // aqui dentro da Edge Function, nunca chega ao navegador do usuário.
    // Usamos isso para buscar os dados da contestação no banco.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: c, error } = await supabase
      .from('contestacoes')
      .select('*')
      .eq('id', contestacaoId)
      .single();

    if (error || !c) {
      return jsonResponse({ erro: 'Contestação não encontrada' }, 404);
    }

    // ── Validação de regra de negócio ───────────────────────────────────
    // Se a operação foi via app Konsi, o procedimento de uso do app
    // precisa estar confirmado ANTES de gerar o laudo — replica no
    // backend a mesma regra que o front-end já valida, como segunda
    // camada de proteção (nunca confiar só na validação do cliente).
    if (c.operacao_via_app && !c.procedimento_app_confirmado) {
      return jsonResponse({
        erro: 'Operação via app Konsi requer confirmação do procedimento de utilização do app antes de gerar o laudo.'
      }, 422);
    }

    const isPortabilidade = (c.operacao || '').toLowerCase().includes('port');
    const temConversas = c.tem_conversas_hyperflow === true;

    // ── Monta o prompt para a IA ─────────────────────────────────────────
    const prompt = `Você é advogado do setor de Compliance Jurídico da Konsi, fintech de crédito consignado.
Redija uma RESPOSTA À CONTESTAÇÃO DE OPERAÇÕES formal e completa, em português jurídico, com base nos dados abaixo.

DADOS:
- Cliente: ${c.nome_cliente} (CPF: ${c.cpf})
- Convênio: ${c.convenio || 'não informado'}
- Banco: ${c.banco || 'não informado'}
- Contrato/ADE: ${c.ade || 'não informado'}
- Operação: ${c.operacao || 'não informado'}
- ${c.valor_liberado ? 'Valor liberado: R$ ' + c.valor_liberado : ''}
- ${c.valor_parcela ? 'Valor da parcela: R$ ' + c.valor_parcela : ''}
- ${c.qtd_parcelas ? 'Quantidade de parcelas: ' + c.qtd_parcelas : ''}
- Motivo da contestação: ${c.motivo || 'não informado'}
- ${c.numero_processo_judicial ? 'Processo nº: ' + c.numero_processo_judicial : ''}
- Fatos alegados: ${c.descricao_fatos || 'alega desconhecimento da contratação'}
- Registros no Hyperflow: ${temConversas ? 'SIM — existem conversas registradas' : 'NÃO — contratação automatizada'}
- Operação via app Konsi: ${c.operacao_via_app ? 'SIM — procedimento de utilização do app deve ser anexado e mencionado' : 'NÃO'}

CONTEXTO KONSI:
A Konsi não faz prospecção ativa. O cliente acessa o app, a Konsi digita a proposta via API junto ao banco.
O banco envia o link de formalização diretamente ao cliente. A coleta e análise biométrica são realizadas pelo próprio banco.
A etapa de formalização é controlada integralmente pela instituição financeira.

INSTRUÇÃO DE FORMATAÇÃO:
Escreva o laudo em texto corrido (sem markdown, sem asteriscos).
Inclua as seções: IDENTIFICAÇÃO DA OPERAÇÃO, DESCRIÇÃO DOS FATOS ALEGADOS, REALIDADE DOS FATOS,
FUNDAMENTAÇÃO LEGAL E REGULATÓRIA${temConversas ? ', REGISTROS DE COMUNICAÇÃO (HYPERFLOW)' : ''}${c.operacao_via_app ? ', PROCEDIMENTO DE UTILIZAÇÃO DO APLICATIVO KONSI' : ''}${isPortabilidade ? ', CONTRATOS PORTADOS' : ''}, CONCLUSÃO.
Cite a Instrução Normativa INSS nº 28/2008 e ${c.motivo === 'FRAUDE' ? 'a Súmula nº 42 do TJBA' : 'jurisprudência pertinente'}.
Finalize com: "Portanto, diante das provas colacionadas, entende-se que a reclamação é IMPROCEDENTE."
Tom: formal, técnico-jurídico, objetivo.`;

    // ── Chama a API da Anthropic ─────────────────────────────────────────
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicResp.ok) {
      const erro = await anthropicResp.text();
      return jsonResponse({ erro: 'Falha ao chamar a IA: ' + erro }, 502);
    }

    const anthropicData = await anthropicResp.json();
    // Truncamento silencioso é pior que erro: se o modelo parou por limite de
    // tokens, o laudo está incompleto — devolve erro em vez de salvar pela metade.
    if (anthropicData.stop_reason === 'max_tokens') {
      return jsonResponse({ erro: 'Laudo truncado pelo limite de tokens — tente gerar novamente.' }, 502);
    }
    const laudo = anthropicData.content?.find((b: any) => b.type === 'text')?.text || '';

    // ── Salva o laudo gerado de volta na contestação ─────────────────────
    await supabase
      .from('contestacoes')
      .update({
        laudo_texto: laudo,
        laudo_gerado_em: new Date().toISOString(),
        etapa_atual: '5_elaboracao',
      })
      .eq('id', contestacaoId);

    // ── Log de auditoria ──────────────────────────────────────────────────
    await supabase.from('logs_auditoria').insert({
      acao: 'LAUDO_GERADO',
      detalhe: `Laudo gerado via IA para contestação de ${c.nome_cliente} (CPF ${c.cpf})`,
      contestacao_id: contestacaoId,
    });

    return jsonResponse({ laudo, ok: true });

  } catch (err) {
    return jsonResponse({ erro: String(err) }, 500);
  }
});

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
