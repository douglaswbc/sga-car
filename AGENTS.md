# SGA v2 — guia de contribuição

## Stack-alvo

Next.js, TypeScript estrito, PostgreSQL/Supabase, Supabase Auth, Tailwind CSS, shadcn/ui e Zod, quando compatíveis com a fase aprovada.

## Arquitetura

- Organizar domínios em `src/features/<domain>`; não criar diretórios ou arquivos vazios.
- Dados operacionais usam `organization_id`. Interfaces ficam em português; código e banco, em inglês.
- Alterações de banco pertencem a migrations pequenas em `supabase/migrations`.
- Toda entrada externa deve ser validada. Não usar `any`, `service_role` no cliente, segredos no código ou RLS como atalho.

## Fluxos críticos

- O estado financeiro local é a fonte de verdade: `contract → invoice → payment`.
- Webhooks são registrados e processados de forma idempotente.
- O SGA decide as regras de negócio; n8n e provedores apenas executam integrações.

## Validação

- Rodar lint, checagem de tipos e testes disponíveis antes da entrega.
- Atualizar a documentação afetada no mesmo change.
- Não alterar o banco legado nem seus dados destrutivamente.
