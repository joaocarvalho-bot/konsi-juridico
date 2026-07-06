# Konsi Jurídico — Backend (Supabase)

Backend do sistema de gestão de contestações jurídicas da Konsi. Substitui o uso de planilhas Google Sheets como fonte de dados por um banco de dados relacional real, mantendo a exportação para Sheets/Drive como uma cópia sob demanda.

---

## Sumário

1. [Por que essa arquitetura](#por-que-essa-arquitetura)
2. [Visão geral das peças](#visão-geral-das-peças)
3. [Passo a passo: criar o projeto Supabase](#passo-a-passo-criar-o-projeto-supabase)
4. [Passo a passo: aplicar o schema do banco](#passo-a-passo-aplicar-o-schema-do-banco)
5. [Passo a passo: criar os usuários (Supabase Auth)](#passo-a-passo-criar-os-usuários-supabase-auth)
6. [Passo a passo: publicar as Edge Functions](#passo-a-passo-publicar-as-edge-functions)
7. [Conectar o front-end (GitHub Pages) ao backend](#conectar-o-front-end-github-pages-ao-backend)
8. [Importar o histórico da planilha antiga](#importar-o-histórico-da-planilha-antiga)
9. [Estrutura de pastas deste projeto](#estrutura-de-pastas-deste-projeto)
10. [Glossário rápido](#glossário-rápido)
11. [Solução de problemas](#solução-de-problemas)

---

## Por que essa arquitetura

O sistema anterior usava um arquivo HTML único com toda a lógica em JavaScript, autenticação simples (usuário/senha fixos no código) e o Google Sheets como "banco de dados" — cada contestação virava uma linha de planilha.

Isso funcionava para o volume inicial, mas trazia limitações ao crescer para um sistema de **gestão** (não só de produção de laudo):

- Planilhas não têm índices, então relatórios com filtros cruzados (banco + período + motivo) ficam lentos e difíceis de montar
- Não há controle de concorrência: duas pessoas editando a mesma linha ao mesmo tempo podem se sobrescrever silenciosamente
- Senhas fixas no código-fonte público (GitHub Pages) são uma falha de segurança
- Cálculos como cohort mensal (operações de um mês × tempo até serem contestadas) são inviáveis de fazer com fórmulas de planilha em milhares de linhas

**A solução:** um banco de dados PostgreSQL gerenciado pelo Supabase, que oferece de graça (no plano free):
- Banco relacional de verdade, com índices e consultas complexas (views SQL)
- Autenticação pronta (Supabase Auth), com recuperação de senha real por e-mail
- Regras de segurança a nível de linha (Row Level Security) que permitem o front-end público falar direto com o banco com segurança
- Edge Functions para as poucas operações que precisam de chave secreta (IA, Google Drive)

O Google Sheets continua existindo, mas como **exportação sob demanda** — o banco de dados é sempre a fonte de verdade.

---

## Visão geral das peças

```
konsi-backend/
├── sql/                          ← Scripts SQL para rodar no Supabase
│   ├── 01_schema.sql              Tabelas, tipos (enums), índices
│   ├── 02_views.sql                Consultas prontas (dashboard, relatórios, cohort)
│   ├── 03_rls_policies.sql        Regras de segurança (quem pode ler/escrever o quê)
│   └── 04_funcao_importacao.sql   Função para importar a planilha histórica
│
├── functions/                     ← Edge Functions (rodam no servidor Supabase)
│   ├── gerar-laudo/                Chama a IA (Anthropic) para redigir o laudo
│   └── sync-drive-sheets/          Sincroniza com Google Drive + Sheets
│
├── cliente-supabase-exemplo.js    ← Como o front-end (HTML) deve chamar tudo isso
└── README.md                      ← Este arquivo
```

### Como as peças se conversam

```
┌─────────────────────┐
│   GitHub Pages       │  ← seu arquivo konsi-contestacoes.html, público
│  (front-end, HTML)   │
└──────────┬───────────┘
           │
           │ 1. Maior parte das operações: direto, usando a chave "anon"
           │    (CRUD de contestações, dashboard, relatórios)
           ▼
┌──────────────────────┐
│      Supabase         │  ← banco de dados + autenticação
│   (PostgreSQL + Auth) │     protegido por Row Level Security
└──────────┬───────────┘
           │
           │ 2. Só para operações que exigem chave secreta:
           ▼
┌──────────────────────┐
│   Edge Functions       │  ← "servidor" que esconde as chaves
│  gerar-laudo            │     fala com a API da Anthropic
│  sync-drive-sheets      │     fala com a API do Google
└──────────────────────┘
```

---

## Passo a passo: criar o projeto Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita (pode usar login com GitHub)
2. Clique em **New Project**
3. Escolha um nome (ex: `konsi-juridico`), uma senha forte para o banco (guarde-a — é diferente das senhas dos usuários do sistema) e a região mais próxima (geralmente `South America (São Paulo)`)
4. Aguarde alguns minutos enquanto o projeto é provisionado

Ao final, anote dois valores em **Project Settings → API**:

| Valor | Onde fica | Uso |
|---|---|---|
| **Project URL** | `https://xxxxx.supabase.co` | Usado no front-end e nas Edge Functions |
| **anon public key** | chave longa começando com `eyJ...` | Usado no front-end (é pública por design) |
| **service_role key** | outra chave longa | **NUNCA** vai para o front-end — só dentro das Edge Functions |

---

## Passo a passo: aplicar o schema do banco

1. No painel do Supabase, vá em **SQL Editor** (ícone de terminal no menu lateral)
2. Clique em **New query**
3. Abra o arquivo `sql/01_schema.sql` deste projeto, copie todo o conteúdo e cole no editor
4. Clique em **Run** (ou `Ctrl+Enter`)
5. Repita o processo, **NESTA ORDEM**, para os arquivos restantes:
   - `sql/02_views.sql`
   - `sql/03_rls_policies.sql`
   - `sql/04_funcao_importacao.sql`

> **Por que a ordem importa:** as views (02) dependem das tabelas existirem (01); as políticas de segurança (03) são aplicadas sobre as tabelas já criadas; a função de importação (04) referencia a tabela de logs criada no schema.

Se algum script der erro, leia a mensagem — geralmente indica que um script anterior não rodou completamente. Você pode rodar `drop table if exists nome_da_tabela cascade;` para uma tabela problemática e tentar de novo.

---

## Passo a passo: criar os usuários (Supabase Auth)

Diferente do sistema anterior (senhas fixas no HTML), agora os usuários ficam no Supabase Auth — um sistema de login de verdade, com senhas criptografadas e recuperação por e-mail.

1. No painel do Supabase, vá em **Authentication → Users**
2. Clique em **Add user → Create new user**
3. Para cada um dos 3 usuários, preencha:

| Campo | Rafael | Wilquer | Juliana |
|---|---|---|---|
| Email | rafaelseixas@konsi.com.br | wilquerbosque@konsi.com.br | julianabacelar@konsi.com.br |
| Password | (defina uma senha forte) | (defina uma senha forte) | (defina uma senha forte) |
| Auto Confirm User | ✅ marcado | ✅ marcado | ✅ marcado |

4. Em **User Metadata** (campo JSON), adicione para cada um:

```json
{ "nome_completo": "Rafael Seixas", "cargo": "Diretor Jurídico" }
```
```json
{ "nome_completo": "Wilquer Bosque", "cargo": "Coordenador Jurídico" }
```
```json
{ "nome_completo": "Juliana Bacelar", "cargo": "Responsável pelas Contestações" }
```

> O trigger `trg_criar_perfil_usuario` (definido em `03_rls_policies.sql`) cria automaticamente a linha correspondente na tabela `usuarios_perfil` assim que o usuário é criado, usando esses metadados.

5. Depois de criados, cada pessoa pode entrar no sistema com seu e-mail e senha, e usar **"Esqueci minha senha"** normalmente — o Supabase envia um e-mail de recuperação de verdade.

---

## Passo a passo: publicar as Edge Functions

As Edge Functions exigem a CLI (linha de comando) do Supabase instalada na sua máquina.

### 1. Instalar a CLI

```bash
npm install -g supabase
```

### 2. Login e vínculo com o projeto

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
```

> O `PROJECT_REF` é o trecho `xxxxx` da URL `https://xxxxx.supabase.co`.

### 3. Configurar as variáveis secretas

Estas chaves nunca vão para o código — ficam guardadas com segurança pelo Supabase:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...", ...}'
supabase secrets set GOOGLE_SHEET_ID=1VgXuIzkqwBkch8LK9NGs7zqY-XTD56VX
supabase secrets set GOOGLE_DRIVE_FOLDER_ID=ID_DA_PASTA_RAIZ_NO_DRIVE
```

**Sobre o `GOOGLE_SERVICE_ACCOUNT_JSON`:** é necessário criar uma Conta de Serviço (Service Account) no Google Cloud Console com acesso à API do Drive e do Sheets, e compartilhar a pasta do Drive e a planilha com o e-mail dessa conta de serviço (algo como `nome@projeto.iam.gserviceaccount.com`). O arquivo JSON baixado do Google Cloud Console deve ser colado inteiro como uma única linha de texto no comando acima.

### 4. Publicar as funções

```bash
supabase functions deploy gerar-laudo
supabase functions deploy sync-drive-sheets
```

Ao final, cada função fica disponível em:
```
https://SEU_PROJECT_REF.supabase.co/functions/v1/gerar-laudo
https://SEU_PROJECT_REF.supabase.co/functions/v1/sync-drive-sheets
```

---

## Conectar o front-end (GitHub Pages) ao backend

1. No arquivo `konsi-contestacoes.html`, adicione no `<head>`, antes do `<script>` principal:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

2. Copie o conteúdo de `cliente-supabase-exemplo.js` para dentro do `<script>` do HTML, substituindo a lógica antiga de autenticação (objeto `USUARIOS` fixo) e de chamadas diretas à API da Anthropic

3. Preencha no topo do código:

```javascript
const SUPABASE_URL = 'https://SEU_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_AQUI';
```

4. Publique o HTML atualizado no GitHub Pages normalmente

> Essas duas informações (URL e chave anon) são seguras para ficar públicas no código — é assim que o Supabase foi projetado para funcionar. A proteção real vem das políticas de RLS no banco (arquivo `03_rls_policies.sql`).

---

## Importar o histórico da planilha antiga

O arquivo `Controle_de_Contestações.xlsx` (331 registros históricos) deve ser importado uma única vez para alimentar o cohort e os rankings históricos.

**No front-end**, a tela de importação deve:

1. Ler o arquivo `.xlsx` usando a biblioteca [SheetJS](https://docs.sheetjs.com/) (`xlsx`), já disponível via CDN
2. Pular as 3 primeiras linhas em branco/título (o cabeçalho real está na linha 4 da planilha original)
3. Montar um array de objetos JavaScript com as chaves: `nome`, `cpf`, `convenio`, `operacao`, `banco`, `ade`, `dataFinalizacao`, `dataRecebimento`, `dataResposta`, `motivo`, `status`, `protocolo`, `canal`, `responsavel`, `risco`, `evidencias`, `listaRestricao`, `observacao`
4. Chamar `importarHistorico(registros)` (ver `cliente-supabase-exemplo.js`, seção 6)

A função SQL `importar_historico_contestacoes` cuida de:
- Validar e descartar datas corrompidas ou fora de intervalo plausível (a planilha original tinha ao menos um registro com ano `0206` em vez de `2026`, que é automaticamente filtrado)
- Registrar avisos de qualidade de dados sem interromper a importação inteira
- Agrupar tudo sob um `lote_importacao` (UUID), permitindo desfazer a importação inteira com `desfazerImportacao(loteId)` se algo sair errado

---

## Estrutura de pastas deste projeto

```
konsi-backend/
├── sql/
│   ├── 01_schema.sql
│   ├── 02_views.sql
│   ├── 03_rls_policies.sql
│   └── 04_funcao_importacao.sql
├── functions/
│   ├── gerar-laudo/
│   │   └── index.ts
│   └── sync-drive-sheets/
│       └── index.ts
├── cliente-supabase-exemplo.js
└── README.md
```

---

## Glossário rápido

| Termo | Explicação simples |
|---|---|
| **Supabase** | Plataforma que oferece um banco PostgreSQL pronto, com autenticação e funções de servidor, sem você precisar configurar nada disso do zero |
| **PostgreSQL** | O banco de dados em si — um sistema robusto e gratuito usado por empresas de todos os portes |
| **RLS (Row Level Security)** | Regras dentro do próprio banco que controlam, linha por linha, quem pode ler ou escrever cada dado |
| **Edge Function** | Um pequeno programa que roda no servidor (não no navegador), usado quando é preciso esconder uma chave secreta |
| **View** | Uma consulta SQL salva que se comporta como uma tabela — usada aqui para os cálculos de dashboard e cohort |
| **ENUM** | Uma lista fechada de valores válidos para uma coluna (ex: status só pode ser "Pendente", "Finalizado", etc.) |
| **Trigger** | Uma ação automática que o banco executa quando algo acontece (ex: converter nome para maiúsculo ao salvar) |
| **Cohort** | Agrupamento de registros por uma característica comum (aqui, o mês em que a operação foi celebrada) para observar um padrão ao longo do tempo |
| **Service Account (Google)** | Uma "conta robô" do Google usada para automatizar acesso ao Drive/Sheets sem depender do login de uma pessoa |

---

## Solução de problemas

### Erro ao rodar os scripts SQL: "relation already exists"

Algum script já foi executado antes. Se quiser recomeçar do zero, rode primeiro:
```sql
drop table if exists logs_auditoria, historico_importado, contestacoes, usuarios_perfil cascade;
drop type if exists status_contestacao, motivo_contestacao, canal_contestacao,
  responsavel_contestacao, nivel_risco, situacao_evidencias, etapa_fluxo cascade;
```
E então rode os 4 scripts novamente, na ordem.

### O front-end não consegue ler nenhum dado, mesmo logado

Verifique se as políticas de RLS foram aplicadas (`03_rls_policies.sql`). Sem RLS habilitado e sem políticas, o Supabase bloqueia tudo por padrão — é o comportamento esperado de segurança, mas significa que o script 03 precisa ter rodado com sucesso.

### A Edge Function `gerar-laudo` retorna erro 401 ou 403

A chave `ANTHROPIC_API_KEY` não foi configurada corretamente. Rode `supabase secrets list` para conferir se ela aparece na lista (o valor não é mostrado, só o nome da variável).

### A sincronização com Drive/Sheets falha

Confirme que:
1. A pasta do Drive e a planilha do Sheets foram **compartilhadas** com o e-mail da Service Account (`...iam.gserviceaccount.com`), com permissão de edição
2. O `GOOGLE_SHEET_ID` e `GOOGLE_DRIVE_FOLDER_ID` estão corretos (são os trechos de ID nas respectivas URLs)

### A importação do histórico trava ou demora muito

Para mais de alguns milhares de linhas, recomenda-se dividir o arquivo em lotes menores (ex: 500 linhas por vez) antes de chamar `importarHistorico`, já que a função processa tudo em uma única transação.

---

*Konsi Tecnologia · Compliance Jurídico*
