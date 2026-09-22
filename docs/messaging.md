# Comunicação

> Para os sete avisos de diária de locação, use o catálogo `meta_whatsapp_templates`: ele preserva os placeholders numéricos exigidos pela Meta. Em Comunicação → Canais, o administrador da plataforma pode usar **Push para Meta** para submeter templates locais/rejeitados e **Pull de status** para registrar aprovação, rejeição, pausa ou desativação. A sincronização exige `META_WHATSAPP_BUSINESS_ACCOUNT_ID` junto ao token da Meta. Esse catálogo comunica regras do SGA; não executa bloqueio físico/remoto de veículo.

O SGA decide as regras e registra a fila; Resend (e-mail) e Meta WhatsApp Cloud API (mensagens) apenas executam a entrega. Nenhuma credencial de provedor vai para o navegador.

## Eventos e canais

Eventos: `member_invite`, `invoice_created`, `payment_receipt`, `invoice_due_soon` e `invoice_overdue`. As cobranças e avisos (`invoice_*` e `payment_receipt`) são enviados **somente por WhatsApp** (Meta Cloud API). O e-mail (Resend) fica restrito ao `member_invite` (convite de equipe) e aos e-mails de autenticação do Supabase (confirmação de conta e recuperação de senha, via SMTP do Resend). Cobrança e recibo são enfileirados dentro das próprias RPCs financeiras, na mesma transação da fatura/pagamento.

## Templates

`message_templates` guarda o padrão global (organização nula) e as personalizações por organização, por canal e evento. Na prática, os templates de **e-mail** se aplicam ao `member_invite`; os de **WhatsApp** cobrem todos os eventos. Os placeholders disponíveis incluem `{{organization_name}}`, `{{member_name}}`, `{{invite_url}}`, `{{tenant_name}}`, `{{amount}}`, `{{due_on}}` e `{{paid_on}}`; valores monetários e datas são formatados em pt-BR no envio. Para WhatsApp, informe o nome e o idioma do template aprovado na Meta; os parâmetros são enviados na ordem do evento (ver `src/lib/messaging/render.ts`).

## Convites de equipe

`organization_invitations` guarda o convite com hash SHA-256 do token (o token bruto só existe no link enviado), validade e papel. O convite é criado e enfileirado por `create_organization_invitation` + `enqueue_organization_invite`; o aceite ocorre em `/convite/[token]`, que valida o token e chama `accept_organization_invitation`. Convites expiram em 7 dias e podem ser reenviados ou revogados na tela de equipe.

## Fila, retentativa e idempotência

`messages` é a fila com estado, tentativas e `next_attempt_at`; `message_events` registra a tentativa/callback. A chave `dedupe_key` única por organização evita envios duplicados. Falhas usam backoff de 1, 5, 15 e 60 minutos, com no máximo 5 tentativas. Contatos sem opt-in são cancelados no envio.

## Disparo

`POST /api/messaging/dispatch` é protegido pelo header `x-dispatch-token` (`MESSAGING_DISPATCH_TOKEN`) e deve ser chamado por cron da VPS ou n8n. A tela `/comunicacao` permite processar a fila e reenviar mensagens. O SGA também pode processar a fila automaticamente com o agendador interno (`MESSAGING_SCHEDULER_ENABLED=true`, ver `docs/operations.md`).

## Webhook da Meta

Cadastre `https://APP_DOMAIN/api/webhooks/whatsapp` na Meta (WhatsApp → Configuration → Webhook, assinando o evento `messages`). A URL e a presença do verify token aparecem em `/comunicacao/canais` para o administrador da plataforma. O `GET` valida `META_WHATSAPP_VERIFY_TOKEN`; o `POST` valida `X-Hub-Signature-256` com `META_WHATSAPP_APP_SECRET` e grava cada evento em `webhook_events` (idempotente por `provider` + `external_id`), atualizando o status das mensagens.

## Preferências e LGPD

`tenant_contact_preferences` guarda opt-in de e-mail e WhatsApp e o momento do consentimento, editável no detalhe do locatário. O envio respeita o opt-in e o histórico fica registrado.

## Variáveis de ambiente

`RESEND_API_KEY`, `SGA_EMAIL_FROM`, `SGA_EMAIL_REPLY_TO` (opcional), `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_GRAPH_VERSION` e `MESSAGING_DISPATCH_TOKEN`.

## Integração externa (n8n) por token de API

Além do cron/dispatch interno, cada organização pode criar tokens de API em **Configurações → Integrações** para que ferramentas externas (ex.: n8n) disparem os envios. O SGA autentica o token, resolve a organização e executa a entrega com as próprias credenciais (nunca expostas). O modo *Entrega de WhatsApp* por organização (`sga` | `n8n`) evita disparos duplicados. Guia completo, endpoints e escopos em `docs/n8n-messaging.md`.

## Testes de conexão

Em `/comunicacao/canais`, o administrador da plataforma vê dois testes, ambos restritos a esse papel e às rotas `POST /api/messaging/whatsapp/test` e `POST /api/messaging/email/test`:

- **Meta WhatsApp**: teste somente leitura que consulta o phone number ID na Graph API e exibe número, nome verificado e qualidade. Exige token com permissão de gerenciamento; sem ela, o erro da Meta é exibido de forma clara.
- **E-mail (Resend)**: valida a chave listando domínios (`GET /domains`) e mostra o status do domínio do remetente; opcionalmente envia um e-mail de teste para um endereço informado. A Resend exige o header `User-Agent`, que o SGA envia.
