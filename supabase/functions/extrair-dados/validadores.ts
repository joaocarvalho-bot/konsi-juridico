// GERADO de konsi-juridico-ia/validadores.mjs — recalibrar na fonte.
// ============================================================================
// KONSI JURÍDICO — VALIDADORES DETERMINÍSTICOS (CNJ + CPF)
// ============================================================================
// ES module puro: roda no Node (testes locais) E no Deno (Edge Function
// `extrair-dados`) sem transpilar. NÃO depende de libs externas.
//
// PAPEL NO PIPELINE DE EXTRAÇÃO:
//   1. A IA extrai campos + auto-avalia confiança (alta/media/vazio).
//   2. ESTES validadores rodam DEPOIS, de forma determinística, e podem
//      REBAIXAR a confiança e anexar flags. São a defesa contra overconfidence:
//      a IA nunca decide sozinha se um número é CNJ válido ou se um CPF fecha
//      o dígito verificador — isso é aritmética, não é para o modelo "achar".
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────
// Tabelas oficiais (Resolução CNJ nº 65/2008)
// ─────────────────────────────────────────────────────────────────────────

// Segmento do Judiciário (dígito J da máscara NNNNNNN-DD.AAAA.J.TR.OOOO)
export const SEGMENTOS_CNJ = {
  '1': 'Supremo Tribunal Federal',
  '2': 'Conselho Nacional de Justiça',
  '3': 'Superior Tribunal de Justiça',
  '4': 'Justiça Federal',
  '5': 'Justiça do Trabalho',
  '6': 'Justiça Eleitoral',
  '7': 'Justiça Militar da União',
  '8': 'Justiça Estadual',
  '9': 'Justiça Militar Estadual',
};

// Tribunal (TR) da Justiça Estadual (J=8). É onde caem ~todas as
// contestações de consignado. Ordem = alfabética por nome do estado.
export const TRIBUNAIS_ESTADUAIS = {
  '01': ['TJAC', 'AC'], '02': ['TJAL', 'AL'], '03': ['TJAP', 'AP'],
  '04': ['TJAM', 'AM'], '05': ['TJBA', 'BA'], '06': ['TJCE', 'CE'],
  '07': ['TJDFT', 'DF'], '08': ['TJES', 'ES'], '09': ['TJGO', 'GO'],
  '10': ['TJMA', 'MA'], '11': ['TJMT', 'MT'], '12': ['TJMS', 'MS'],
  '13': ['TJMG', 'MG'], '14': ['TJPA', 'PA'], '15': ['TJPB', 'PB'],
  '16': ['TJPR', 'PR'], '17': ['TJPE', 'PE'], '18': ['TJPI', 'PI'],
  '19': ['TJRJ', 'RJ'], '20': ['TJRN', 'RN'], '21': ['TJRS', 'RS'],
  '22': ['TJRO', 'RO'], '23': ['TJRR', 'RR'], '24': ['TJSC', 'SC'],
  '25': ['TJSE', 'SE'], '26': ['TJSP', 'SP'], '27': ['TJTO', 'TO'],
};

// ─────────────────────────────────────────────────────────────────────────
// CNJ
// ─────────────────────────────────────────────────────────────────────────

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
// Ruido comum de OCR -> digito. Usar SO em campos numericos (CNJ). NUNCA em CPF
// (o CPF deve reprovar o DV errado; corrigir mascararia a fraude/erro).
const sanitizarOCR = (s) => String(s ?? '').replace(/[Oo]/g, '0').replace(/[lI]/g, '1');

// ISO 7064 MOD 97-10 iterativo (evita estourar Number com 20 dígitos).
function mod97(digitos) {
  let resto = 0;
  for (let i = 0; i < digitos.length; i++) {
    resto = (resto * 10 + (digitos.charCodeAt(i) - 48)) % 97;
  }
  return resto;
}

/**
 * Analisa um número candidato a processo CNJ.
 *
 * Discriminador central: um número pode CASAR a máscara (7-2.4.1.2.4) e ainda
 * assim NÃO ser um processo judicial — é o caso dos protocolos internos da
 * Facta (ex.: 2606025-20.0100.2.16.3010, ano "0100" impossível e DV quebrado).
 * Só é `cnj_valido` quando: máscara ok + dígito verificador (mod 97) ok +
 * ano plausível + segmento válido.
 *
 * @returns {{
 *   input:string, limpo:string, mascara_ok:boolean, formatado:string|null,
 *   seq:string|null, dv:string|null, ano:number|null, segmento:string|null,
 *   tribunal:string|null, origem:string|null, dv_ok:boolean, dv_esperado:string|null,
 *   ano_plausivel:boolean, segmento_nome:string|null, tribunal_sigla:string|null,
 *   uf:string|null, valido:boolean, classificacao:'cnj_valido'|'provavel_protocolo_interno'|'formato_invalido',
 *   flags:string[]
 * }}
 */
export function analisarCNJ(input, { maxAno } = {}) {
  const anoMax = maxAno ?? (new Date().getFullYear() + 1);
  const bruto = soDigitos(input);              // sem sanitizar
  const d = soDigitos(sanitizarOCR(input));    // corrige ruido de OCR ANTES do mod 97
  const ocr_corrigido = d !== bruto;
  const flags = [];
  if (ocr_corrigido) flags.push('Ruido de OCR corrigido no numero (O->0 / l,I->1) antes da validacao.');

  const base = {
    input: String(input ?? ''), limpo: d, ocr_corrigido, mascara_ok: false, formatado: null,
    seq: null, dv: null, ano: null, segmento: null, tribunal: null, origem: null,
    dv_ok: false, dv_esperado: null, ano_plausivel: false,
    segmento_nome: null, tribunal_sigla: null, uf: null,
    valido: false, classificacao: 'formato_invalido', flags,
  };

  if (d.length !== 20) {
    flags.push(`Esperado 20 dígitos, encontrado ${d.length}.`);
    return base;
  }

  const seq = d.slice(0, 7);
  const dv = d.slice(7, 9);
  const anoStr = d.slice(9, 13);
  const seg = d.slice(13, 14);
  const trib = d.slice(14, 16);
  const orig = d.slice(16, 20);
  const ano = Number(anoStr);

  base.mascara_ok = true;
  base.seq = seq; base.dv = dv; base.ano = ano;
  base.segmento = seg; base.tribunal = trib; base.origem = orig;
  base.formatado = `${seq}-${dv}.${anoStr}.${seg}.${trib}.${orig}`;

  // Dígito verificador: (NNNNNNN AAAA J TR OOOO DD) mod 97 deve dar 1.
  const rearranjado = seq + anoStr + seg + trib + orig + dv;
  base.dv_ok = mod97(rearranjado) === 1;
  // DV correto (para diagnóstico): 98 - ((...00) mod 97), formatado 2 dígitos.
  const dvCalc = 98 - mod97(seq + anoStr + seg + trib + orig + '00');
  base.dv_esperado = String(dvCalc).padStart(2, '0');
  if (!base.dv_ok) flags.push(`Dígito verificador inválido (esperado ${base.dv_esperado}, veio ${dv}).`);

  // Ano plausível: numeração unificada começou em 2010; toleramos processos
  // renumerados desde 1998. Ano fora disso é forte sinal de protocolo interno.
  base.ano_plausivel = ano >= 1998 && ano <= anoMax;
  if (!base.ano_plausivel) flags.push(`Ano implausível (${anoStr}).`);

  base.segmento_nome = SEGMENTOS_CNJ[seg] ?? null;
  if (!base.segmento_nome) flags.push(`Segmento de justiça desconhecido (J=${seg}).`);

  if (seg === '8') {
    const t = TRIBUNAIS_ESTADUAIS[trib];
    if (t) { base.tribunal_sigla = t[0]; base.uf = t[1]; }
    else flags.push(`Tribunal estadual desconhecido (TR=${trib}).`);
  }

  const segValido = !!base.segmento_nome;
  base.valido = base.dv_ok && base.ano_plausivel && segValido;

  if (base.valido) {
    base.classificacao = 'cnj_valido';
  } else {
    // Casou a máscara mas falhou integridade → provável protocolo interno do
    // banco disfarçado de CNJ. NUNCA tratar como processo judicial real.
    base.classificacao = 'provavel_protocolo_interno';
    flags.push('Casa a máscara CNJ mas falha a validação — provável protocolo interno do banco, NÃO é processo judicial.');
  }

  return base;
}

/**
 * Varre um texto livre e devolve TODOS os candidatos a CNJ (com ou sem
 * pontuação, inclusive nome de arquivo com 20 dígitos colados).
 */
export function extrairCNJs(texto, opts) {
  const t = String(texto ?? '');
  const achados = new Map(); // limpo -> analise (dedup)
  // 1) máscara pontuada
  const reMasc = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g;
  // 2) 20 dígitos colados (nome de arquivo de petição)
  const reCru = /\d{20}/g;
  for (const re of [reMasc, reCru]) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const a = analisarCNJ(m[0], opts);
      if (a.limpo.length === 20 && !achados.has(a.limpo)) achados.set(a.limpo, a);
    }
  }
  return [...achados.values()];
}

// ─────────────────────────────────────────────────────────────────────────
// CPF
// ─────────────────────────────────────────────────────────────────────────

/**
 * Valida CPF pelos dois dígitos verificadores. NÃO "corrige" — só diz se
 * fecha. Usado para rebaixar confiança quando OCR ruim gera CPF impossível.
 * @returns {{input:string, limpo:string, valido:boolean, formatado:string|null, motivo:string|null}}
 */
export function validarCPF(input) {
  const d = soDigitos(input);
  const out = { input: String(input ?? ''), limpo: d, valido: false, formatado: null, motivo: null };

  if (d.length !== 11) { out.motivo = `Esperado 11 dígitos, veio ${d.length}.`; return out; }
  if (/^(\d)\1{10}$/.test(d)) { out.motivo = 'Todos os dígitos iguais.'; return out; }

  const dv = (base, pesoIni) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoIni - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d.slice(0, 9), 10);
  const d2 = dv(d.slice(0, 10), 11);

  out.valido = d1 === Number(d[9]) && d2 === Number(d[10]);
  out.formatado = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  if (!out.valido) out.motivo = 'Dígitos verificadores não conferem.';
  return out;
}
