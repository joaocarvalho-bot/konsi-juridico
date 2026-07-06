# Design — Front-end Konsi Jurídico (`konsi-contestacoes.html`)

> **Data:** 01/07/2026
> **Autor:** João Victor Carvalho Borges + Claude
> **Status:** aguardando aprovação para plano de implementação

---

## 1. Objetivo

Reconstruir o front-end de gestão de contestações jurídicas da Konsi como um **único arquivo HTML** (para publicação no GitHub Pages) que consome o backend Supabase já pronto (`sql/`, `functions/`), substituindo o sistema legado que guardava tudo em RAM/`sessionStorage` e chamava a Anthropic direto do browser (chave exposta).

**Não-objetivo:** mexer no backend. O SQL e as Edge Functions estão prontos e são a fonte de verdade. Este design só cobre o front-end.

---

## 2. Decisões de escopo (aprovadas por default)

| Decisão | Escolha |
|---|---|
| Fidelidade visual | **Idêntica** ao legado — paleta verde Konsi, fontes Manrope/JetBrains Mono, layout sidebar escura + topbar branca, gráficos de barra em CSS puro. **Logo real da Konsi** (SVG de `konsi-icon-transparent.svg`) embutido como `<symbol>`. Mockup aprovado em 06/07/2026 (versão "clássica pós-logo"); variantes glassmorphism e neumorfismo foram testadas e **rejeitadas**. |
| Autenticação | `USUARIOS` fixo → **Supabase Auth** (`signInWithPassword`, `resetPasswordForEmail`, sessão persistente). |
| Persistência | RAM/`sessionStorage` → **tabelas Postgres** via `@supabase/supabase-js` v2 (UMD, CDN). |
| Geração de laudo | fetch Anthropic direto → **Edge Function `gerar-laudo`**. |
| Features novas incluídas | Importação `.xlsx` do histórico, relatórios com filtros, dashboard cohort/tempo médio, campos de app Konsi + evidências (3 estados). |
| Auto-fill por IA (link Konsigleads + OCR de print/PDF) | **Adiado para fase 2** — hoje expõe a chave; vira nova Edge Function depois. Etapa de recepção passa a ser **digitação manual**. |

---

## 3. Arquitetura

```
konsi-contestacoes.html  (GitHub Pages, público)
  ├── <head>: Google Fonts + @supabase/supabase-js@2 (UMD, CDN) + SheetJS/xlsx (CDN, só p/ importação)
  ├── <style>: CSS do legado (variáveis :root verdes) reaproveitado integralmente
  ├── markup: tela-login  +  #app (sidebar + topbar + páginas)
  └── <script>:
        - config (SUPABASE_URL, SUPABASE_ANON_KEY)  ← preencher no topo
        - camada supabase = createClient(...)
        - funções portadas do cliente-supabase-exemplo.js (auth, CRUD, dashboard, import, logs)
        - controlador de UI (showPage, setStep, render*)
```

- **Single-file**, sem build step — coerente com o legado e com o deploy em GitHub Pages descrito no README.
- Toda a lógica de dados reusa as funções já especificadas em `cliente-supabase-exemplo.js` (é a referência canônica da integração). O trabalho é **colar essa camada e ligá-la à UI**, não reinventá-la.
- Segurança: só `SUPABASE_URL` + `anon key` no código (públicas por design; proteção real é o RLS). Nenhuma chave secreta no browser.

---

## 4. Telas e navegação

Mesmo padrão do legado: `showPage(nome)` alterna `<div>`s por classe `.active`; `#tela-login` como overlay antes do login.

| Tela | Origem | Fonte de dados |
|---|---|---|
| **Login** | legado (adaptado) | `supabase.auth` |
| **Nova contestação** | legado (5→6 etapas) | `contestacoes` (insert/update por etapa) |
| **Histórico** | legado | `contestacoes` (select, filtro rápido) |
| **Dashboard** | legado + expandido | `vw_dashboard_kpis`, `vw_ranking_*`, `vw_tempo_medio_resumo`, `vw_cohort_mensal`, `vw_volume_mensal` |
| **Relatórios** *(nova)* | — | `vw_contestacoes_consolidado` + filtros |
| **Importação histórico** *(nova)* | — | SheetJS → `importar_historico_contestacoes` |

---

## 5. Fluxo da contestação (6 etapas → schema)

O stepper do legado tinha 5 passos; o backend modela 6 `etapa_fluxo`. Mapeamento e campos por etapa (nomes de coluna do schema):

1. **`1_recepcao`** — dados mínimos da notificação: `nome_cliente`, `cpf`, `ade`, `banco`, `motivo`, `canal`, `data_recebimento`. → `criarContestacaoEtapa1`.
2. **`2_operacao`** — dados da operação: `convenio`, `operacao`, `valor_liberado`, `valor_parcela`, `qtd_parcelas`, `data_finalizacao_proposta`, `numero_processo_judicial`, `responsavel`, `nivel_risco`, `descricao_fatos`, `observacao_interna`. → `atualizarContestacaoEtapa2`.
3. **`3_subsidios`** — `situacao_evidencias` (4 estados: Com/Sem/Dispensa/A definir), `arquivo_evidencia_url`, `tem_conversas_hyperflow`, **`operacao_via_app`** + **`procedimento_app_confirmado`** (checkbox obrigatório se via app). Validações espelhadas do `cliente-supabase-exemplo.js`. → `atualizarContestacaoEtapa3`.
4. **`4_previa`** — prévia textual do laudo (template estático client-side, sem IA) para conferência.
5. **`5_elaboracao`** — botão "Elaborar laudo com IA" → `gerarLaudo(id)` (Edge Function). Exibe o `laudo_texto`, permite regenerar.
6. **`6_finalizado`** — `protocolo_envio`, `data_resposta`, `lista_restricao`, `advogado_responsavel`, `envio_confirmado`. → `finalizarContestacao` (seta `status='Finalizado'`, dispara `sync-drive-sheets` em background).

Ações transversais: **Salvar como pendente** a qualquer momento (`salvarComoPendente`); toda ação relevante grava em `logs_auditoria` via `registrarLog`.

Enums do formulário (dropdowns) vêm exatamente dos tipos do `01_schema.sql` — nada de texto livre onde há enum, pra não quebrar as views.

---

## 6. Dashboard

Reusa os gráficos de barra CSS do legado e adiciona os cortes que as views novas habilitam:

- **KPIs** (`vw_dashboard_kpis`): total no sistema, pendentes, finalizadas, total c/ histórico, média de dias até contestação, total do mês.
- **Rankings** (barras): bancos, produtos, motivos, convênios.
- **Tempo médio até contestação** (`vw_tempo_medio_resumo`): geral + por banco.
- **Cohort mensal** (`vw_cohort_mensal`): matriz mês da operação × faixa de dias.
- **Volume mensal** (`vw_volume_mensal`): série temporal recebidas/finalizadas.

Sem lib de gráfico: mantém a renderização por template string + `innerHTML` do legado. Cohort vira uma tabela-matriz simples.

---

## 7. Relatórios (nova tela)

Formulário de filtros → `gerarRelatorio(filtros)` sobre `vw_contestacoes_consolidado`: período (`data_recebimento` gte/lte), `operacao`, `convenio`, `banco`, `motivo`, `canal`, `status`. Resultado em tabela ordenada por data desc, com botão de **exportar CSV** client-side.

---

## 8. Importação de histórico (nova tela)

1. Upload do `.xlsx` (`Controle_de_Contestações.xlsx`, ~331 linhas) via `<input type=file>`.
2. SheetJS lê a planilha, **pula as 3 primeiras linhas** (cabeçalho real na linha 4), monta array com as chaves esperadas pela função: `nome, cpf, convenio, operacao, banco, ade, dataFinalizacao, dataRecebimento, dataResposta, motivo, status, protocolo, canal, responsavel, risco, evidencias, listaRestricao, observacao`.
3. `importarHistorico(registros)` → RPC `importar_historico_contestacoes`.
4. Exibe resultado (`total_recebidos/importados/com_avisos/lote_id`) e oferece **desfazer** (`desfazerImportacao(loteId)`).
5. Recomenda lotes de ~500 linhas (nota do README) — para 331, um lote só.

---

## 9. Fluxo de dados (resumo)

```
Login  → supabase.auth.signInWithPassword → carrega usuarios_perfil → topbar
CRUD   → supabase.from('contestacoes').insert/update (RLS: authenticated)
Laudo  → fetch Edge Function gerar-laudo (Bearer = access_token da sessão)
Final  → update status + fetch Edge Function sync-drive-sheets (background)
Dash   → supabase.from('vw_*').select()
Import → supabase.rpc('importar_historico_contestacoes', {...})
Log    → supabase.from('logs_auditoria').insert (em cada ação)
```

---

## 10. Tratamento de erros

- Toda chamada Supabase checa `error` e mostra toast/inline claro em PT-BR (padrão do legado).
- Login inválido → "E-mail ou senha incorretos."
- Edge Function fora do ar / 4xx/5xx → mensagem específica (ex.: laudo, sync) sem travar o resto da UI.
- Validações de negócio no client **e** no backend (app Konsi, evidências) — segunda camada já existe nas Edge Functions.
- Sessão expirada ao recarregar → `verificarSessaoAtiva` restaura ou volta ao login.

---

## 11. Configuração / deploy

- Preencher no topo do `<script>`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Publicar no GitHub Pages (mesmo fluxo do README).
- Pré-requisito operacional (fora deste front): projeto Supabase criado, SQLs 01–04 aplicados, 3 usuários criados, Edge Functions publicadas com secrets. (Documentado no README; não bloqueia a escrita do HTML.)

---

## 12. Fora de escopo (fase 2)

- **Auto-fill por IA**: leitura de link Konsigleads (web_search) + OCR de print/PDF para pré-preencher a etapa 1. Vira Edge Function `extrair-dados` (esconde a chave). Até lá, etapa 1 é manual.
- Página `redefinir-senha.html` (o `resetPasswordForEmail` referencia; pode ser um segundo arquivo simples — decidir no plano).
- Realtime/subscriptions (não necessário para 3 usuários).

---

## 13. Estratégia de teste

Sem framework (single-file). Verificação manual roteirizada:
1. Login/logout + persistência de sessão no reload.
2. Criar contestação percorrendo as 6 etapas; conferir `etapa_atual`/`status` no Supabase.
3. Regra app Konsi: bloquear laudo sem `procedimento_app_confirmado`.
4. Gerar laudo (mock/real) e finalizar; conferir `logs_auditoria` e disparo do sync.
5. Importar `.xlsx` de teste e desfazer pelo `lote_id`.
6. Dashboard e relatórios batendo com os dados inseridos.
7. RLS: sem login não lê nada.

---

## 14. Riscos / pontos de atenção

- **Modelo Anthropic** nas Edge Functions está `claude-sonnet-4-20250514` (antigo). Sinalizar troca para modelo atual no plano (não é bloqueio do front).
- **`sync-drive-sheets`** lê `c.observacao` mas a coluna é `observacao_interna` — provável bug no backend a confirmar (fora do escopo deste front, mas registrar).
- Layout do stepper muda de 5 para 6 passos — ajustar o componente visual do legado.
```
