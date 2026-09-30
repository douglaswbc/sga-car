# Operações, observabilidade e backups

## Logs estruturados

`src/lib/observability/logger.ts` emite JSON (`level`, `message`, `time` e campos extras). Use em rotas e integrações; nunca registre segredos, tokens ou dados pessoais completos. O dispatcher de mensagens e o health check já registram eventos.

Exemplo: `logger.info("messaging.dispatch", { sent, failed })`.

## Health check

`GET /api/health` responde `200` com `{ status: "ok" }` quando o banco responde e `503` com `{ status: "degraded" }` em caso de falha. Aponte o monitor (Uptime Kuma, Better Stack, etc.) para essa rota. Não requer autenticação e não expõe dados.

## Monitoramento e alertas

- Configure um monitor externo no `/api/health` com alerta por e-mail/WhatsApp.
- Colete os logs no provedor de sua preferência. A observabilidade está habilitada em `wrangler.jsonc` (`observability.enabled`); o `Cron Trigger` também registra `cron.dispatch.status` e `cron.dispatch.sem_token` no log do Worker.
- Erros de aplicação: considere Sentry ou equivalente; o ponto de integração é `src/app/(app)/error.tsx` e o `logger`.
- Alertas operacionais já existem no dashboard (devoluções, manutenções e cobranças).

## Limitação de taxa

`src/lib/security/rate-limit.ts` mantém janelas em memória (por instância). Aplicado em login, cadastro, recuperação de senha e dispatcher. Em múltiplas instâncias, troque por um armazenamento compartilhado (ex.: Redis).

## Agendamento dos envios

A fila de mensagens (`messages`) é preenchida pelas regras do SGA, mas precisa de um gatilho para processar (gerar lembretes e enviar).

**O gatilho padrão é o Cron Trigger da Cloudflare**, declarado em `wrangler.jsonc > triggers.crons` e implementado em `worker.ts`. A cada 15 minutos ele chama `POST /api/messaging/dispatch` autenticado por `MESSAGING_DISPATCH_TOKEN`. O handler reentra pelo *service binding* `WORKER_SELF_REFERENCE` porque o contexto de request do OpenNext só existe dentro de `fetch`.

Não existe agendador interno: o Worker não tem processo de longa duração, então `setInterval` não sobreviveria entre requisições. O agendador in-process que vivia em `src/instrumentation.ts` foi removido, junto com `MESSAGING_SCHEDULER_ENABLED` e `MESSAGING_SCHEDULER_INTERVAL_MS`.

Alternativas, se preferir processar fora da Cloudflare:

- **n8n** — `Schedule Trigger` → `POST /api/messaging/dispatch` (token global) ou a API de integração por organização (ver `docs/n8n-messaging.md`).
- **Chamada manual** — **Processar fila** em `/comunicacao`, ou o endpoint direto.

A fila usa `FOR UPDATE SKIP LOCKED`, então chamadas concorrentes não duplicam mensagens. Sem gatilho, as mensagens ficam em `pending`.

Sem um desses gatilhos, as mensagens ficam em `pending` e só são enviadas ao usar **Processar fila** em `/comunicacao` ou ao chamar o endpoint manualmente.

## Backup e restauração

O banco é do Supabase. Prefira o backup gerenciado da Supabase (PITR). Para cópias pontuais, use o cliente PostgreSQL (`pg_dump`/`pg_restore`) com `DATABASE_URL` no `.env`:

```bash
npm run backup    # gera backups/sga-<timestamp>.dump (formato custom)
npm run restore -- backups/sga-<timestamp>.dump
```

Agendamento sugerido em qualquer host com Node, diário às 02:00 e retenção de 14 dias:

```bash
0 2 * * * cd /opt/sga && npm run backup >> /var/log/sga-backup.log 2>&1
30 3 * * * find /opt/sga/backups -name 'sga-*.dump' -mtime +14 -delete
```

Validação periódica (trimestral): restaurar o último dump em um banco isolado e conferir contagens de `invoices` e `payments`.

## Checklist antes da implantação pública

- [ ] Domínio apontando para o Worker e TLS ativo.
- [ ] Segredos cadastrados com `npx wrangler secret put`: `DATABASE_URL`, `INTEGRATION_ENCRYPTION_KEY`, `MESSAGING_DISPATCH_TOKEN`, `RESEND_API_KEY`, `SGA_EMAIL_FROM`.
- [ ] Bucket R2 de cache criado e vinculado em `wrangler.jsonc`.
- [ ] `/api/health` monitorado com alerta.
- [ ] Backup agendado e uma restauração testada em banco isolado.
- [ ] Rate limit ativo e revisado.
- [ ] Revisão de RLS nas tabelas novas.
- [ ] `service_role` ausente do cliente e segredos fora do Git.
