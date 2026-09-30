# SGA v2 — guia de contribuição

## Stack-alvo

Next.js, TypeScript estrito, PostgreSQL/Supabase, Supabase Auth, Tailwind CSS, shadcn/ui e Zod, quando compatíveis com a fase aprovada.

## Infraestrutura

O SGA é implantado como Cloudflare Worker (OpenNext) e usa o Supabase como banco oficial. Não há Docker, VPS ou proxy reverso.

- `DATABASE_URL` (transaction pooler, 6543) é a única URL: serve a aplicação e as migrations. A transaction mode **não aceita prepared statements** — nunca passe `name` para `query()`, nem use `SET`, `LISTEN/NOTIFY` ou temp tables entre transações.
- O pooler do Supabase usa CA privada. A raiz pública está versionada em `supabase-ca.pem` e embutida no bundle via `src/lib/supabase/ca.ts` (`npm run ca:sync`). **Nunca desligue a validação do certificado.**
- O runtime é o do Workers: não há sistema de arquivos, portanto nada de `node:fs` e certificado de CA por variável, não por caminho.
- Não há processo de longa duração. Tarefas periódicas usam Cron Trigger (`wrangler.jsonc` + `worker.ts`), nunca `setInterval`.
- `cloudflare-env.d.ts` fica fora do `tsconfig.json` principal (ver `tsconfig.worker.json`); incluí-la troca os tipos de `Response.json()` e quebra o typecheck da aplicação.

## Arquitetura

- Organizar domínios em `src/features/<domain>`; não criar diretórios ou arquivos vazios.
- Dados operacionais usam `organization_id`. Interfaces ficam em português; código e banco, em inglês.
- Alterações de banco pertencem a migrations pequenas em `supabase/migrations`, acrescentadas **depois** de `0001_baseline.sql`. O baseline é gerado (`npm run db:baseline`) e não se edita à mão.
- Toda entrada externa deve ser validada. Não usar `any`, `service_role` no cliente, segredos no código ou RLS como atalho.

## Fluxos críticos

- O estado financeiro local é a fonte de verdade: `contract → invoice → payment`.
- Webhooks são registrados e processados de forma idempotente.
- O WhatsApp é entregue pelo Zernio, com credenciais por organização cifradas em `organization_zernio_connections`. A integração direta com a Meta Cloud API foi removida; não reintroduza `META_WHATSAPP_*`.
- Webhook do Zernio: o corpo é lido cru para validar o HMAC, e o `payload.id` é deduplicado em `webhook_events` antes de processar. A entrega é at-least-once.
- O SGA decide as regras de negócio; n8n e provedores apenas executam integrações.

## Validação

- Rodar lint, checagem de tipos e testes disponíveis antes da entrega.
- Atualizar a documentação afetada no mesmo change.
- Não alterar o banco legado nem seus dados destrutivamente.
