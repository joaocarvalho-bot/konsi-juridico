# Edge Function: `extrair-dados`

Auto-preenchimento por IA das etapas 1–2 da contestação. Recebe a notificação
(e-mail em texto / PDF / print) e devolve os campos com nível de confiança
(`alta`/`media`/`vazio`). **Não grava nada** — o advogado revisa no front e salva.

Pipeline em 2 fases (anti-overconfidence): a IA extrai + auto-avalia; depois os
validadores determinísticos (CNJ mod 97 / CPF DV) rodam e podem **rebaixar** a
confiança. Modelos: e-mail → Haiku 4.5; PDF/imagem → Sonnet 5.

## Arquivos
| Arquivo | Origem | Versionado aqui? |
|---|---|---|
| `index.ts` | escrito à mão — **fonte de verdade** | ✅ |
| `schema.ts`, `validadores.ts` | **gerados** da calibração | ✅ (regeneráveis) |
| `prompt.ts` | **gerado** — heurística de banco | ❌ **git-ignored** (fica no repo privado `konsi-juridico-ia`) |

## Deploy
O `prompt.ts` não está neste repo. Antes de deployar, regenere-o a partir do
clone do repo **privado** `konsi-juridico-ia`:

```bash
# no clone de konsi-juridico-ia:
node build-edge-function.mjs            # escreve prompt.ts (+ schema.ts, validadores.ts) nesta pasta
# de volta em konsi-juridico:
supabase functions deploy extrair-dados
```

Secret necessária: `ANTHROPIC_API_KEY` (já configurada — o `gerar-laudo` usa).
Se recalibrar (mudou prompt/schema/validadores no repo privado), rode o gerador
de novo e re-commite `schema.ts`/`validadores.ts` se mudarem.
