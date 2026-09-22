# Operações, observabilidade e backups

## Logs estruturados

`src/lib/observability/logger.ts` emite JSON (`level`, `message`, `time` e campos extras). Use em rotas e integrações; nunca registre segredos, tokens ou dados pessoais completos. O dispatcher de mensagens e o health check já registram eventos.

Exemplo: `logger.info("messaging.dispatch", { sent, failed })`.

## Health check

`GET /api/health` responde `200` com `{ status: "ok" }` quando o banco responde e `503` com `{ status: "degraded" }` em caso de falha. Aponte o monitor (Uptime Kuma, Better Stack, etc.) para essa rota. Não requer autenticação e não expõe dados.

## Monitoramento e alertas

- Configure um monitor externo no `/api/health` com alerta por e-mail/WhatsApp.
- Colete os logs JSON do container (Docker) no provedor de sua preferência.
- Erros de aplicação: considere Sentry ou equivalente; o ponto de integração é `src/app/(app)/error.tsx` e o `logger`.
- Alertas operacionais já existem no dashboard (devoluções, manutenções e cobranças).

## Limitação de taxa

`src/lib/security/rate-limit.ts` mantém janelas em memória (por instância). Aplicado em login, cadastro, recuperação de senha, webhook da Meta e dispatcher. Em múltiplas instâncias, troque por um armazenamento compartilhado (ex.: Redis).

## Agendamento dos envios

A fila de mensagens (`messages`) é preenchida pelas regras do SGA, mas precisa de um gatilho para processar (gerar lembretes e enviar). Há três formas; use **uma** principal para evitar disparos sobrepostos (a fila usa `FOR UPDATE SKIP LOCKED`, então chamadas concorrentes não duplicam):

1. **Agendador interno (recomendado na VPS)** — o próprio processo do Next processa a fila periodicamente. Defina no `.env`:
   ```env
   MESSAGING_SCHEDULER_ENABLED=true
   MESSAGING_SCHEDULER_INTERVAL_MS=900000
   ```
   O intervalo mínimo é 30s; o padrão é 15 min. Roda no runtime Node (não impacta o build) e registra `scheduler.dispatch`/`scheduler.dispatch_failed` nos logs. Em múltiplas réplicas, é seguro (claim com lock).

2. **Cron da VPS** — chame o endpoint externo com o token:
   ```cron
   */15 * * * * curl -fsS -X POST -H "x-dispatch-token: $MESSAGING_DISPATCH_TOKEN" https://SEU_DOMINIO/api/messaging/dispatch
   ```

3. **n8n** — `Schedule Trigger` → `POST /api/messaging/dispatch` (token global) ou a API de integração por organização (ver `docs/n8n-messaging.md`).

Sem um desses gatilhos, as mensagens ficam em `pending` e só são enviadas ao usar **Processar fila** em `/comunicacao` ou ao chamar o endpoint manualmente.

## Backup e restauração

Requisitos: cliente PostgreSQL (`pg_dump`/`pg_restore`) disponível no host e `DATABASE_URL` no `.env`.

```bash
npm run backup    # gera backups/sga-<timestamp>.dump (formato custom)
npm run restore -- backups/sga-<timestamp>.dump
```

Agendamento sugerido (cron na VPS), diário às 02:00 e retenção de 14 dias:

```cron
0 2 * * * cd /opt/sga && npm run backup >> /var/log/sga-backup.log 2>&1
30 3 * * * find /opt/sga/backups -name 'sga-*.dump' -mtime +14 -delete
```

Validação periódica (trimestral): restaurar o último dump em um banco isolado e conferir contagens de `invoices` e `payments`.

## Checklist antes da implantação pública

- [ ] Domínio TLS ativo (Caddy) e cabeçalhos HTTPS.
- [ ] `RESEND_API_KEY`, `SGA_EMAIL_FROM` e `MESSAGING_DISPATCH_TOKEN` definidos.
- [ ] `/api/health` monitorado com alerta.
- [ ] Backup agendado e uma restauração testada em banco isolado.
- [ ] Rate limit ativo e revisado.
- [ ] Revisão de RLS nas tabelas novas.
- [ ] `service_role` ausente do cliente e segredos fora do Git.
