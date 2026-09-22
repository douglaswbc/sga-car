# Integração com n8n (tokens de API)

O n8n dispara os envios de cobrança; o SGA decide as regras e **executa a entrega** com as próprias credenciais da Meta (WhatsApp), que nunca saem do servidor. As cobranças e avisos saem apenas por WhatsApp; o e-mail (Resend) é usado só para convites e autenticação. A autenticação é feita por **token de API por organização**.

## Criar um token

Em **Configurações → Integrações** (owner/admin):

1. Informe um nome (ex.: `n8n cobrança`).
2. Selecione os escopos necessários.
3. Escolha a validade (padrão sugerido: 90 dias).
4. Copie o token exibido **uma única vez**. Ele não é armazenado em claro (apenas o hash SHA-256).

## Escopos

| Escopo | Uso |
| --- | --- |
| `messaging:send` | Disparar o envio de cobranças/lembretes da organização |
| `messaging:read` | Consultar fila e histórico de comunicações |
| `invoices:read` | Ler faturas e pagamentos |
| `tenants:read` | Ler locatários |
| `contracts:read` | Ler contratos |

## Autenticação

Envie o token no cabeçalho `Authorization: Bearer sga_...` (ou `x-api-key`). Sempre HTTPS.

## Endpoints

Base: `https://SEU_DOMINIO/api/integrations`.

- `POST /messaging/dispatch` (`messaging:send`) — gera lembretes de vencimento e envia as mensagens de cobrança pendentes da organização por WhatsApp (e-mail apenas para convites). Resposta: `{ reminders, processed, sent, failed, cancelled }`.
- `GET /messaging/messages?limit=100` (`messaging:read`) — fila/status/histórico.
- `GET /invoices?limit=100` (`invoices:read`)
- `GET /tenants?limit=200` (`tenants:read`)
- `GET /contracts?limit=100` (`contracts:read`)

Exemplo:

```bash
curl -X POST https://SEU_DOMINIO/api/integrations/messaging/dispatch \
  -H "Authorization: Bearer sga_SEU_TOKEN" \
  -H "Content-Type: application/json"
```

## Fluxo no n8n

1. **Schedule Trigger** (ex.: a cada 15 min; lembrete diário às 09:00).
2. **HTTP Request**
   - Method: `POST`
   - URL: `https://SEU_DOMINIO/api/integrations/messaging/dispatch`
   - Header: `Authorization: Bearer sga_...`
3. Trate a resposta (`sent`, `failed`) e, se quiser, consulte `GET /messaging/messages` para conciliação.

Configure o token como **credential/Header Auth** no n8n (não em texto no nó), para não expor em exportações de fluxo.

## Modo de entrega por organização

Em **Comunicação → Canais**, o campo *Entrega de WhatsApp* define:

- **SGA (Meta Cloud API)** — o cron/dispatch do SGA envia normalmente.
- **n8n (via token)** — o disparo global do SGA **ignora o WhatsApp** desta organização; o n8n chama `POST /messaging/dispatch` com o token.

O e-mail permanece no SGA. Isso evita envios duplicados.

## Idempotência e garantias

- A fila usa `FOR UPDATE SKIP LOCKED`; disparos concorrentes não duplicam.
- Semântica *at-least-once*: mensagens em `processing` há mais de 10 minutos voltam a ser reivindicáveis. Confirme o envio (o retorno do endpoint) e evite chamadas sobrepostas.
- Retentativas com backoff (1, 5, 15, 60 min) e máximo de 5 tentativas.

## Segurança

- Token só em hash, exibido uma vez; suporta expiração, revogação e registro de `last_used_at`.
- Escopos mínimos e endpoints sempre limitados à organização do token.
- Criação, revogação e uso geram trilha em `audit_logs`.
- Rate limit por token. Nenhuma credencial de provedor é exposta ao n8n.

## Solução de problemas

- `401` — token inválido, expirado ou revogado.
- `403` — escopo insuficiente para o recurso.
- `429` — muitas chamadas; respeite `Retry-After`.
- Nada é enviado — verifique o modo de entrega da organização e se há mensagens `pending` com `next_attempt_at <= now()`.
