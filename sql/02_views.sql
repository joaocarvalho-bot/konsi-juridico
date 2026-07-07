-- ============================================================================
-- KONSI JURÍDICO — VIEWS DE CONSULTA (Dashboard, Relatórios, Cohort)
-- ============================================================================
-- Uma VIEW é uma "consulta salva" que se comporta como se fosse uma tabela.
-- Em vez de cada tela do front-end escrever sua própria query SQL complexa,
-- ela simplesmente faz "select * from vw_nome_da_view" e recebe os dados
-- já prontos. Vantagens:
--   1. A lógica de cálculo fica em UM lugar só (aqui), não duplicada em
--      vários trechos de JavaScript
--   2. Se a regra de negócio mudar (ex: trocar como calculamos "tempo até
--      contestação"), atualiza-se a view uma vez e todo o sistema reflete
--   3. Mais simples de testar e auditar
-- ============================================================================


-- ----------------------------------------------------------------------------
-- VIEW: vw_contestacoes_consolidado
-- ----------------------------------------------------------------------------
-- Une os dados OPERACIONAIS (tabela contestacoes, fluxo atual) com os dados
-- HISTÓRICOS (tabela historico_importado, planilha antiga) em um formato
-- comum. É a fonte única para Dashboard e Relatórios, que não precisam
-- se preocupar com a origem do dado.
create view vw_contestacoes_consolidado as
select
  id,
  nome_cliente,
  cpf,
  convenio,
  operacao,
  banco,
  ade,
  data_finalizacao_proposta,
  data_recebimento,
  data_resposta,
  motivo::text as motivo,
  status::text as status,
  canal::text as canal,
  responsavel::text as responsavel,
  nivel_risco::text as nivel_risco,
  situacao_evidencias::text as situacao_evidencias,
  observacao_interna as observacao,
  'operacional' as fonte
from contestacoes

union all

select
  id,
  nome_cliente,
  cpf,
  convenio,
  operacao,
  banco,
  ade,
  data_finalizacao_proposta,
  data_recebimento,
  data_resposta,
  motivo,
  status,
  canal,
  responsavel,
  nivel_risco,
  situacao_evidencias,
  observacao,
  'historico' as fonte
from historico_importado;

comment on view vw_contestacoes_consolidado is
  'União de contestações operacionais atuais + histórico importado, para uso em relatórios e dashboard.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_ranking_bancos
-- ----------------------------------------------------------------------------
-- "Os bancos com maior número de contestações" — um dos itens pedidos
-- para o dashboard. Ordenado do maior para o menor volume.
create view vw_ranking_bancos as
select
  banco,
  count(*) as total_contestacoes,
  count(*) filter (where status = 'Finalizado') as total_finalizadas,
  round(100.0 * count(*) filter (where status = 'Finalizado') / nullif(count(*),0), 1) as pct_finalizadas
from vw_contestacoes_consolidado
where banco is not null and banco <> ''
group by banco
order by total_contestacoes desc;

comment on view vw_ranking_bancos is
  'Ranking de bancos por volume de contestações, com taxa de finalização.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_ranking_produtos
-- ----------------------------------------------------------------------------
-- "Os produtos com maior número de contestações"
create view vw_ranking_produtos as
select
  operacao as produto,
  count(*) as total_contestacoes,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct_do_total
from vw_contestacoes_consolidado
where operacao is not null and operacao <> ''
group by operacao
order by total_contestacoes desc;

comment on view vw_ranking_produtos is
  'Ranking de produtos/operações por volume de contestações.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_ranking_motivos
-- ----------------------------------------------------------------------------
create view vw_ranking_motivos as
select
  motivo,
  count(*) as total_contestacoes
from vw_contestacoes_consolidado
where motivo is not null and motivo <> ''
group by motivo
order by total_contestacoes desc;


-- ----------------------------------------------------------------------------
-- VIEW: vw_ranking_convenios
-- ----------------------------------------------------------------------------
create view vw_ranking_convenios as
select
  convenio,
  count(*) as total_contestacoes
from vw_contestacoes_consolidado
where convenio is not null and convenio <> ''
group by convenio
order by total_contestacoes desc;


-- ----------------------------------------------------------------------------
-- VIEW: vw_tempo_ate_contestacao
-- ----------------------------------------------------------------------------
-- "Qual o tempo médio entre celebração da operação e a contestação"
--
-- Calcula, linha a linha, quantos dias se passaram entre a operação ser
-- formalizada (data_finalizacao_proposta) e a contestação chegar
-- (data_recebimento). Só considera linhas onde AMBAS as datas existem e
-- fazem sentido (recebimento depois da finalização — protege contra
-- dados corrompidos como a data com ano "0206" encontrada na planilha
-- original, que seria filtrada por essa condição).
create view vw_tempo_ate_contestacao as
select
  id,
  banco,
  operacao,
  convenio,
  data_finalizacao_proposta,
  data_recebimento,
  (data_recebimento - data_finalizacao_proposta) as dias_ate_contestacao
from vw_contestacoes_consolidado
where data_finalizacao_proposta is not null
  and data_recebimento is not null
  and data_recebimento >= data_finalizacao_proposta
  -- descarta intervalos absurdos (provavelmente erro de digitação),
  -- nenhuma contestação realista demora mais de 10 anos
  and (data_recebimento - data_finalizacao_proposta) < 3650;

comment on view vw_tempo_ate_contestacao is
  'Dias corridos entre a celebração da operação e o recebimento da contestação, por registro individual.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_tempo_medio_resumo
-- ----------------------------------------------------------------------------
-- Resumo agregado do tempo até contestação: média geral, mediana,
-- e quebra por banco (alguns bancos podem ter padrões de contestação
-- mais rápidos ou mais lentos que outros).
create view vw_tempo_medio_resumo as
select
  'geral' as recorte,
  null as chave,
  round(avg(dias_ate_contestacao)) as media_dias,
  percentile_cont(0.5) within group (order by dias_ate_contestacao) as mediana_dias,
  count(*) as total_amostras
from vw_tempo_ate_contestacao

union all

select
  'banco' as recorte,
  banco as chave,
  round(avg(dias_ate_contestacao)) as media_dias,
  percentile_cont(0.5) within group (order by dias_ate_contestacao) as mediana_dias,
  count(*) as total_amostras
from vw_tempo_ate_contestacao
group by banco;

comment on view vw_tempo_medio_resumo is
  'Tempo médio e mediano até a contestação, geral e por banco.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_cohort_mensal
-- ----------------------------------------------------------------------------
-- "Qual o cohort das operações: operações de janeiro costumam ser
-- contestadas em quanto tempo?"
--
-- Um "cohort" agrupa operações pelo MÊS EM QUE FORAM CELEBRADAS (não pelo
-- mês da contestação) e mede, para cada grupo, em quantos dias depois a
-- contestação apareceu. Isso revela padrões como "operações fechadas em
-- dezembro são contestadas mais rápido que as de junho" — possivelmente
-- por sazonalidade de fraude, época de 13º salário, etc.
--
-- A view classifica cada contestação em uma "faixa de dias" (0-30, 31-60,
-- 61-90, 91-180, 181-365, 365+) dentro do mês de origem da operação.
-- O front-end monta a matriz cohort (mês × faixa de dias) a partir disso.
create view vw_cohort_mensal as
select
  date_trunc('month', data_finalizacao_proposta)::date as mes_operacao,
  case
    when dias_ate_contestacao <= 30  then '0-30 dias'
    when dias_ate_contestacao <= 60  then '31-60 dias'
    when dias_ate_contestacao <= 90  then '61-90 dias'
    when dias_ate_contestacao <= 180 then '91-180 dias'
    when dias_ate_contestacao <= 365 then '181-365 dias'
    else 'mais de 365 dias'
  end as faixa_dias,
  count(*) as total_operacoes,
  round(avg(dias_ate_contestacao)) as media_dias_na_faixa
from vw_tempo_ate_contestacao
group by 1, 2
order by 1, 2;

comment on view vw_cohort_mensal is
  'Agrupa operações pelo mês de celebração e mede em quanto tempo depois foram contestadas, em faixas de dias.';


-- ----------------------------------------------------------------------------
-- VIEW: vw_volume_mensal
-- ----------------------------------------------------------------------------
-- Série temporal simples: quantas contestações foram RECEBIDAS por mês.
-- Útil para o dashboard mostrar tendência ao longo do tempo (gráfico de
-- linha), independente do cohort de origem da operação.
create view vw_volume_mensal as
select
  date_trunc('month', data_recebimento)::date as mes,
  count(*) as total_contestacoes,
  count(*) filter (where status = 'Finalizado') as total_finalizadas
from vw_contestacoes_consolidado
where data_recebimento is not null
group by 1
order by 1;


-- ----------------------------------------------------------------------------
-- VIEW: vw_dashboard_kpis
-- ----------------------------------------------------------------------------
-- Números de resumo para os cartões no topo do dashboard.
create view vw_dashboard_kpis as
select
  (select count(*) from contestacoes) as total_ativo_sistema,
  (select count(*) from contestacoes where status = 'Pendente') as total_pendentes,
  (select count(*) from contestacoes where status = 'Finalizado') as total_finalizadas_sistema,
  (select count(*) from vw_contestacoes_consolidado) as total_geral_com_historico,
  (select round(avg(dias_ate_contestacao)) from vw_tempo_ate_contestacao) as media_dias_geral,
  (select count(*) from contestacoes
     where date_trunc('month', data_recebimento) = date_trunc('month', current_date)
  ) as total_mes_atual;


-- ----------------------------------------------------------------------------
-- SEGURANÇA: security_invoker em TODAS as views
-- ----------------------------------------------------------------------------
-- Por padrão, views no Postgres executam com a permissão do DONO (postgres),
-- o que CONTORNA o Row Level Security das tabelas por baixo — na prática,
-- um visitante anônimo com a chave pública conseguia ler as contestações
-- pelas views, mesmo com as tabelas blindadas. (Vazamento real encontrado e
-- corrigido na verificação do gate em 07/07/2026.)
-- Com security_invoker = true, a view executa com a permissão de QUEM
-- consulta — o RLS das tabelas volta a valer em toda consulta via view.
alter view vw_contestacoes_consolidado set (security_invoker = true);
alter view vw_ranking_bancos           set (security_invoker = true);
alter view vw_ranking_produtos         set (security_invoker = true);
alter view vw_ranking_motivos          set (security_invoker = true);
alter view vw_ranking_convenios        set (security_invoker = true);
alter view vw_tempo_ate_contestacao    set (security_invoker = true);
alter view vw_tempo_medio_resumo       set (security_invoker = true);
alter view vw_cohort_mensal            set (security_invoker = true);
alter view vw_volume_mensal            set (security_invoker = true);
alter view vw_dashboard_kpis           set (security_invoker = true);
