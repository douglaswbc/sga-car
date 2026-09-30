# Comunicação

> O canal de WhatsApp é entregue pelo **Zernio**, que substituiu a integração direta com a Meta Cloud API. Cada organização informa a própria API key e o `accountId` da sua conta de WhatsApp em Comunicação → Canais; ambas ficam cifradas com AES-256-GCM em `organization_zernio_connections`. A API key nunca é lida do ambiente nem exposta ao navegador — a RLS bloqueia qualquer leitura pelo cliente e o status chega à interface por uma função `SECURITY DEFINER` que devolve apenas identificadores públicos. Para os sete avisos de diária, o catálogo `zernio_whatsapp_templates` preserva os placeholders numéricos exigidos pela Meta. Esse catálogo comunica regras do SGA; não executa bloqueio físico/remoto de veículo.

O SGA decide as regras e registra a fila; Resend (e-mail) e Zernio (WhatsApp) apenas executam a entrega.

## Eventos e canais

Eventos: `member_invite`, `invoice_created`, `payment_receipt`, `invoice_due_soon` e `invoice_overdue`. As cobranças e avisos (`invoice_*` e `payment_receipt`) são enviados **somente por WhatsApp**. O e-mail (Resend) fica restrito ao `member_invite` (convite de equipe) e aos e-mails de autenticação do Supabase (confirmação de conta e recuperação de senha, via SMTP do Resend). Cobrança e recibo são enfileirados dentro das próprias RPCs financeiras, na mesma transação da fatura/pagamento.

## Templates

`message_templates` guarda o padrão global (organização nula) e as personalizações por organização, por canal e evento. Na prática, os templates de **e-mail** se aplicam ao `member_invite`; os de **WhatsApp** cobrem todos os eventos. Os placeholders disponíveis incluem `{{organization_name}}`, `{{member_name}}`, `{{invite_url}}`, `{{tenant_name}}`, `{{amount}}`, `{{due_on}}` e `{{paid_on}}`; valores monetários e datas são formatados em pt-BR no envio. Para WhatsApp, informe o nome e o idioma do modelo aprovado; os parâmetros são enviados na ordem do evento (ver `src/lib/messaging/render.ts`).

### Por que todo envio usa um modelo aprovado

A Meta **não permite texto livre para abrir uma conversa** no WhatsApp. A API do Zernio responde `TEMPLATE_REQUIRED` quando `templateName` não é informado. Como a SGA não rastreia a janela de 24 horas de uma conversa já aberta, ela sempre envia por um modelo aprovado — o mesmo caminho que já funcionava na integração direta. Texto livre só é aceito dentro dessa janela.

A aprovação é feita pela Meta e costuma levar até 24 horas. O fluxo em Comunicação → Canais é: **Enviar modelos pendentes** submete os modelos locais e rejeitados; **Atualizar status** busca o estado atual na Zernio (aprovado, rejeitado, pausado, desativado).

A API da Zernio valida o nome do modelo com `^[a-z][a-z0-9_]*$`, então nomes de exibição do SGA são normalizados apenas no momento do envio.

## Conexão do número com a Zernio

Salvar a API key não basta: a Meta exige uma conexão de Embedded Signup para vincular o número à WABA. O botão **Conectar número de WhatsApp** faz isso:

1. O SGA chama `GET /v1/connect/whatsapp` com `signup=hosted`, `language=pt-BR` e a marca da organização.
2. A Zernio hospeda a tela e abre o popup da Meta dentro dela. Isso importa: no fluxo direto, quando o login do Facebook enxerga vários números, a Meta devolve só um código de autorização e o usuário cai no seletor de número da Zernio, tendo que escolher de novo. Com `hosted`, a Zernio aprende qual WABA e qual número foram escolhidos e conecta exatamente aquele.
3. O navegador do administrador é levado para lá e volta sozinho ao SGA.

O nonce que identifica a tentativa viaja na própria `redirect_url` (`?sga_state=`), porque a Zernio preserva os query params do redirecionamento. **Nenhum parâmetro do callback é considerado confiável**: a organização vem do nonce, não da query, e o `accountId` é reconferido contra as contas de WhatsApp da API key antes de ser gravado. Um callback adulterado não consegue apontar a organização para uma conta de terceiro.

Se o usuário fechar o popup, a Zernio redireciona com `error=connection_cancelled`, tratado como falha reversível.

## Webhook de eventos

Conectar o número e ouvir eventos são passos independentes. O botão **Registrar webhook** chama `POST /v1/webhooks/settings` com a URL da organização, os eventos e um `secret` gerado pelo SGA — a Zernio assina com ele e nunca o gera sozinha.

A URL carrega o `accountId` (`/api/webhooks/zernio/{accountId}`) porque **cada organização registra o seu endpoint e tem o seu próprio secret**. Sem isso, a rota teria que testar N segredos.

Eventos assinados:

| Evento | Efeito no SGA |
| --- | --- |
| `message.received` | Arquiva a resposta em `zernio_inbound_messages` |
| `message.delivered` / `read` / `failed` | Atualiza o status de `messages` pelo `provider_message_id` (o `wamid`) |
| `whatsapp.template.status_updated` | Aprovação de modelo chega sozinha, sem polling |
| `account.disconnected` | Registra o evento para diagnóstico |

Com isso, os botões manuais de sincronizar modelo viram apenas um plano B.

### Assinatura e idempotência

- O corpo é lido **cru** antes de qualquer parse, porque a assinatura é HMAC-SHA256 do corpo bruto. A comparação usa `timingSafeEqual`.
- A entrega é *at-least-once*: a Zernio repete o mesmo `payload.id` em até 7 tentativas, com backoff de até 24h. O SGA insere o id em `webhook_events` (`unique (provider, external_id)`) antes de processar, e um conflito encerra o fluxo.
- A rota precisa responder **2xx em 5 segundos**; um erro faz a Zernio reagendar.
- `webhook.test` chega antes de qualquer inscrição e serve para validar a configuração pela tela.

## Conversão do telefone

A Zernio exige o número em formato internacional apenas com dígitos, com código do país. `toE164()` normaliza e rejeita o que estiver fora da faixa plausível, antes de gastar uma chamada de rede.

## Convites de equipe

`organization_invitations` guarda o convite com hash SHA-256 do token (o token bruto só existe no link enviado), validade e papel. O convite é criado e enfileirado por `create_organization_invitation` + `enqueue_organization_invite`; o aceite ocorre em `/convite/[token]`, que valida o token e chama `accept_organization_invitation`. Convites expiram em 7 dias e podem ser reenviados ou revogados na tela de equipe.

## Fila, retentativa e idempotência

`messages` é a fila com estado, tentativas e `next_attempt_at`; `message_events` registra a tentativa. A chave `dedupe_key` única por organização evita envios duplicados. Falhas usam backoff de 1, 5, 15 e 60 minutos, com no máximo 5 tentativas. Contatos sem opt-in são cancelados no envio.

## Disparo

`POST /api/messaging/dispatch` é protegido pelo header `x-dispatch-token` (`MESSAGING_DISPATCH_TOKEN`). Ele é chamado pelo **Cron Trigger** da Cloudflare a cada 15 minutos (`wrangler.jsonc > triggers.crons`), cujo handler está em `worker.ts`.

O SGA **não** mantém agendador interno: o Worker não tem processo de longa duração, então `setInterval` não sobreviveria entre requisições. O agendador in-process que existia em `src/instrumentation.ts` foi removido.

A tela `/comunicacao` permite processar a fila manualmente e reenviar mensagens.

## Preferências e LGPD

`tenant_contact_preferences` guarda opt-in de e-mail e WhatsApp e o momento do consentimento, editável no detalhe do locatário. O envio respeita o opt-in e o histórico fica registrado.

## Variáveis de ambiente

`RESEND_API_KEY`, `SGA_EMAIL_FROM`, `SGA_EMAIL_REPLY_TO` (opcional), `ZERNIO_API_BASE_URL` (padrão `https://zernio.com/api/v1`), `INTEGRATION_ENCRYPTION_KEY` e `MESSAGING_DISPATCH_TOKEN`.

As credenciais do Zernio **não** são variáveis de ambiente: são por organização e vivem cifradas no banco.

Trocar `INTEGRATION_ENCRYPTION_KEY` invalida todas as credenciais já gravadas. A chave é derivada por HKDF-SHA256 a partir do valor configurado.

## Integração externa (n8n) por token de API

Cada organização pode criar tokens de API em **Configurações → Integrações** para que ferramentas externas (ex.: n8n) disparem os envios. O SGA autentica o token, resolve a organização e executa a entrega com as próprias credenciais (nunca expostas). O campo *Quem inicia os envios de WhatsApp* (`sga` | `n8n` | `zernio`) evita disparos duplicados. Guia completo, endpoints e escopos em `docs/n8n-messaging.md`.

## Testes de conexão

Em `/comunicacao/canais`, o administrador da organização tem **Testar conexão**, que valida a API key e confirma que o `accountId` configurado existe entre as contas de WhatsApp. O administrador da plataforma vê o teste de e-mail em `POST /api/messaging/email/test`, que valida a chave listando domínios (`GET /domains`) e opcionalmente envia um e-mail de teste. A Resend exige o header `User-Agent`, que o SGA envia.
