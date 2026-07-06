// ============================================================================
// KONSI JURÍDICO — CLIENTE SUPABASE (exemplo de integração com o front-end)
// ============================================================================
// Este arquivo mostra COMO o sistema HTML (konsi-contestacoes.html) deve
// se conectar ao backend Supabase. Não é executado sozinho — o conteúdo
// dele deve ser copiado para dentro do <script> do arquivo HTML principal,
// substituindo a lógica antiga que usava a API da Anthropic diretamente
// e o localStorage/sessionStorage para "fingir" um backend.
// ============================================================================

// ──────────────────────────────────────────────────────────────────────────
// 1. CONFIGURAÇÃO INICIAL
// ──────────────────────────────────────────────────────────────────────────
// Estas duas informações são PÚBLICAS por design — não são segredo.
// A chave "anon" só permite o que as políticas de RLS autorizarem
// (ver sql/03_rls_policies.sql). Pegue os dois valores em:
// Supabase → Project Settings → API

const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_PUBLICA_AQUI';

// O SDK do Supabase é carregado via CDN — adicione esta linha no <head>
// do HTML, antes do seu <script> principal:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ──────────────────────────────────────────────────────────────────────────
// 2. AUTENTICAÇÃO (substitui o objeto USUARIOS hardcoded)
// ──────────────────────────────────────────────────────────────────────────

async function fazerLogin(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    throw new Error('E-mail ou senha incorretos.');
  }

  // Busca os dados complementares do perfil (nome, cargo)
  const { data: perfil } = await supabase
    .from('usuarios_perfil')
    .select('*')
    .eq('id', data.user.id)
    .single();

  await registrarLog('LOGIN', `Login realizado por ${perfil.nome_completo}`);

  return { usuario: data.user, perfil };
}

async function fazerLogout() {
  const sessao = await supabase.auth.getSession();
  if (sessao.data.session) {
    await registrarLog('LOGOUT', 'Logout manual');
  }
  await supabase.auth.signOut();
}

// Verifica se já existe uma sessão ativa (ex: ao recarregar a página)
async function verificarSessaoAtiva() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;

  const { data: perfil } = await supabase
    .from('usuarios_perfil')
    .select('*')
    .eq('id', data.session.user.id)
    .single();

  return { usuario: data.session.user, perfil };
}

// Recuperação de senha — dispara e-mail de verdade via Supabase Auth
async function solicitarRecuperacaoSenha(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/redefinir-senha.html',
  });
  if (error) throw error;
}


// ──────────────────────────────────────────────────────────────────────────
// 3. CRUD DE CONTESTAÇÕES
// ──────────────────────────────────────────────────────────────────────────

// Etapa 1: cria o registro inicial com os dados mínimos da notificação
async function criarContestacaoEtapa1(dados) {
  const { data, error } = await supabase
    .from('contestacoes')
    .insert({
      nome_cliente: dados.nome,        // o banco já converte para MAIÚSCULO via trigger
      cpf: dados.cpf,
      ade: dados.ade,
      banco: dados.banco,
      motivo: dados.motivo,
      canal: dados.canal,
      data_recebimento: dados.dataRecebimento,
      etapa_atual: '1_recepcao',
      origem_registro: dados.origem || 'manual', // 'manual' | 'extensao_chrome'
    })
    .select()
    .single();

  if (error) throw error;

  await registrarLog('CONTESTACAO_CRIADA', `Nova contestação: ${data.nome_cliente}`, data.id);
  return data;
}

// Etapa 2: completa os dados da operação (essenciais para o laudo)
async function atualizarContestacaoEtapa2(id, dados) {
  const { data, error } = await supabase
    .from('contestacoes')
    .update({
      convenio: dados.convenio,
      operacao: dados.operacao,
      valor_liberado: dados.valorLiberado,
      valor_parcela: dados.valorParcela,
      qtd_parcelas: dados.qtdParcelas,
      data_finalizacao_proposta: dados.dataFinalizacao,
      numero_processo_judicial: dados.processo,
      responsavel: dados.responsavel,
      nivel_risco: dados.risco,
      descricao_fatos: dados.fatos,
      observacao_interna: dados.observacao,
      etapa_atual: '2_operacao',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Etapa 3: subsídios — evidências, Hyperflow, procedimento do app
async function atualizarContestacaoEtapa3(id, dados) {
  // Validação de regra de negócio no próprio front (a Edge Function
  // gerar-laudo também valida, como segunda camada de proteção)
  if (dados.operacaoViaApp && !dados.procedimentoAppConfirmado) {
    throw new Error(
      'Operação via app Konsi: é obrigatório confirmar o procedimento de utilização do aplicativo.'
    );
  }
  if (dados.situacaoEvidencias === 'Com evidências' && !dados.arquivoEvidenciaUrl) {
    throw new Error('Marcado "Com evidências": é necessário anexar o arquivo.');
  }

  const { data, error } = await supabase
    .from('contestacoes')
    .update({
      situacao_evidencias: dados.situacaoEvidencias,
      arquivo_evidencia_url: dados.arquivoEvidenciaUrl,
      tem_conversas_hyperflow: dados.temConversasHyperflow,
      operacao_via_app: dados.operacaoViaApp,
      procedimento_app_confirmado: dados.procedimentoAppConfirmado,
      etapa_atual: '3_subsidios',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Etapa 4/5: chama a Edge Function que gera o laudo via IA
async function gerarLaudo(contestacaoId) {
  const { data: sessao } = await supabase.auth.getSession();

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/gerar-laudo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessao.session.access_token}`,
    },
    body: JSON.stringify({ contestacaoId }),
  });

  const resultado = await resp.json();
  if (!resp.ok) throw new Error(resultado.erro || 'Falha ao gerar laudo');
  return resultado.laudo;
}

// Etapa 6: finalização — confirma envio e dispara sincronização Drive/Sheets
async function finalizarContestacao(id, dados) {
  if (!dados.envioConfirmado) {
    throw new Error('Confirme o envio da resposta antes de finalizar.');
  }

  const { data, error } = await supabase
    .from('contestacoes')
    .update({
      protocolo_envio: dados.protocolo,
      data_resposta: dados.dataResposta,
      lista_restricao: dados.listaRestricao,
      advogado_responsavel: dados.advogado,
      envio_confirmado: true,
      status: 'Finalizado',
      etapa_atual: '6_finalizado',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  await registrarLog('CONTESTACAO_FINALIZADA', `Finalizada: ${data.nome_cliente}`, id);

  // Dispara a sincronização com Drive/Sheets (não bloqueia a UI —
  // "sob demanda" conforme decidido, roda em background)
  sincronizarComGoogle(id).catch(console.error);

  return data;
}

// Salvar como pendente a qualquer momento do fluxo (sem exigir todas as etapas)
async function salvarComoPendente(id, dadosParciais) {
  const { data, error } = await supabase
    .from('contestacoes')
    .update({ ...dadosParciais, status: 'Pendente' })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}


// ──────────────────────────────────────────────────────────────────────────
// 4. SINCRONIZAÇÃO COM GOOGLE (Drive + Sheets) — SOB DEMANDA
// ──────────────────────────────────────────────────────────────────────────

async function sincronizarComGoogle(contestacaoId) {
  const { data: sessao } = await supabase.auth.getSession();

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-drive-sheets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessao.session.access_token}`,
    },
    body: JSON.stringify({ contestacaoId }),
  });

  const resultado = await resp.json();
  if (!resp.ok) throw new Error(resultado.erro || 'Falha ao sincronizar com Google');
  return resultado;
}


// ──────────────────────────────────────────────────────────────────────────
// 5. DASHBOARD E RELATÓRIOS (lê as views do banco)
// ──────────────────────────────────────────────────────────────────────────

async function buscarKpisDashboard() {
  const { data, error } = await supabase.from('vw_dashboard_kpis').select('*').single();
  if (error) throw error;
  return data;
}

async function buscarRankingBancos() {
  const { data, error } = await supabase.from('vw_ranking_bancos').select('*');
  if (error) throw error;
  return data;
}

async function buscarRankingProdutos() {
  const { data, error } = await supabase.from('vw_ranking_produtos').select('*');
  if (error) throw error;
  return data;
}

async function buscarTempoMedioResumo() {
  const { data, error } = await supabase.from('vw_tempo_medio_resumo').select('*');
  if (error) throw error;
  return data;
}

async function buscarCohortMensal() {
  const { data, error } = await supabase.from('vw_cohort_mensal').select('*');
  if (error) throw error;
  return data;
}

async function buscarVolumeMensal() {
  const { data, error } = await supabase.from('vw_volume_mensal').select('*');
  if (error) throw error;
  return data;
}

// Relatório com filtros (data, operação, convênio, banco, motivo, canal)
async function gerarRelatorio(filtros) {
  let query = supabase.from('vw_contestacoes_consolidado').select('*');

  if (filtros.dataInicio) query = query.gte('data_recebimento', filtros.dataInicio);
  if (filtros.dataFim) query = query.lte('data_recebimento', filtros.dataFim);
  if (filtros.operacao) query = query.eq('operacao', filtros.operacao);
  if (filtros.convenio) query = query.eq('convenio', filtros.convenio);
  if (filtros.banco) query = query.eq('banco', filtros.banco);
  if (filtros.motivo) query = query.eq('motivo', filtros.motivo);
  if (filtros.canal) query = query.eq('canal', filtros.canal);
  if (filtros.status) query = query.eq('status', filtros.status);

  const { data, error } = await query.order('data_recebimento', { ascending: false });
  if (error) throw error;
  return data;
}


// ──────────────────────────────────────────────────────────────────────────
// 6. IMPORTAÇÃO DE HISTÓRICO (upload da planilha .xlsx)
// ──────────────────────────────────────────────────────────────────────────
// Pressupõe que o front-end já leu o arquivo .xlsx com uma biblioteca
// como SheetJS (xlsx) e converteu para um array de objetos JavaScript
// no mesmo formato usado durante a análise da planilha original.

async function importarHistorico(registros) {
  const { data: sessao } = await supabase.auth.getSession();
  const usuarioId = sessao.session.user.id;

  const { data, error } = await supabase.rpc('importar_historico_contestacoes', {
    registros: registros,           // array de objetos
    usuario_importador: usuarioId,
  });

  if (error) throw error;
  return data[0]; // { total_recebidos, total_importados, total_com_avisos, lote_id }
}

async function desfazerImportacao(loteId) {
  const { data: sessao } = await supabase.auth.getSession();
  const usuarioId = sessao.session.user.id;

  const { data, error } = await supabase.rpc('desfazer_importacao', {
    p_lote_id: loteId,
    p_usuario: usuarioId,
  });

  if (error) throw error;
  return data; // número de registros removidos
}


// ──────────────────────────────────────────────────────────────────────────
// 7. LOGS DE AUDITORIA
// ──────────────────────────────────────────────────────────────────────────

async function registrarLog(acao, detalhe, contestacaoId = null) {
  const { data: sessao } = await supabase.auth.getSession();
  if (!sessao.session) return; // sem sessão, não registra (ex: tentativa de login falha)

  const { data: perfil } = await supabase
    .from('usuarios_perfil')
    .select('nome_completo')
    .eq('id', sessao.session.user.id)
    .single();

  await supabase.from('logs_auditoria').insert({
    usuario_id: sessao.session.user.id,
    usuario_nome: perfil?.nome_completo,
    acao,
    detalhe,
    contestacao_id: contestacaoId,
    ip_user_agent: navigator.userAgent.slice(0, 200),
  });
}

async function buscarLogsContestacao(contestacaoId) {
  const { data, error } = await supabase
    .from('logs_auditoria')
    .select('*')
    .eq('contestacao_id', contestacaoId)
    .order('criado_em', { ascending: false });

  if (error) throw error;
  return data;
}
