# E-mail transacional com Resend

O Resend será o provedor SMTP dos e-mails de autenticação do Supabase: confirmação de conta, recuperação de senha e futuros convites. A chave SMTP fica somente no painel do Supabase; ela não deve ser adicionada ao `.env` do Next.js, ao Git ou ao navegador.

## Preparar o Resend

1. Crie e verifique um domínio no Resend, preferencialmente um subdomínio exclusivo para autenticação, como `auth.seu-dominio.com`.
2. Publique os registros DNS de SPF e DKIM fornecidos pelo Resend e aguarde a verificação.
3. Crie uma API key de envio no Resend. Ela será usada como senha SMTP.

## Configurar o Supabase

No painel do projeto, abra **Authentication > Email > SMTP Settings** e habilite SMTP personalizado:

| Campo | Valor |
| --- | --- |
| Host | `smtp.resend.com` |
| Porta | `465` |
| Usuário | `resend` |
| Senha | API key do Resend |
| Remetente | `no-reply@auth.seu-dominio.com` |
| Nome do remetente | `SGA` |

Mantenha a confirmação de e-mail ativada. Em **Authentication > Email Templates**, preserve o modelo de confirmação definido em `docs/auth-setup.md`, pois ele encaminha o token para a rota segura `/auth/confirm`.

## Validação

1. Crie uma conta de teste no SGA com um e-mail externo à equipe do Supabase.
2. Confirme que o e-mail chega com o remetente verificado e que o link leva ao SGA.
3. Verifique os logs de Auth no Supabase e a atividade de envio no Resend.

Use um domínio e remetente exclusivos para autenticação; não misture esses e-mails com marketing.

## Checklist de produção (envio do SGA)

Os e-mails transacionais do SGA (`member_invite`, `invoice_created`, `payment_receipt`, `invoice_due_soon`, `invoice_overdue`) usam a API HTTP da Resend, não o SMTP do Supabase. Antes de liberar:

1. Domínio verificado no Resend (SPF, DKIM e DMARC publicados).
2. `RESEND_API_KEY`, `SGA_EMAIL_FROM` (remetente no domínio verificado) e, opcionalmente, `SGA_EMAIL_REPLY_TO` cadastrados como segredos do Worker (`npx wrangler secret put`).
3. `MESSAGING_DISPATCH_TOKEN` definido e o Cron Trigger da Cloudflare chamando `POST /api/messaging/dispatch` (ver `docs/deployment.md`).
4. Em `/comunicacao/canais`, validar a chave (deve mostrar o domínio do remetente como `verified`) e enviar um e-mail de teste.
5. Testar um convite de equipe ponta a ponta (link em `/convite/[token]`) e uma cobrança gerada.

A ativação depende de acesso ao DNS e ao painel do Resend; sem essas credenciais, o item permanece pendente de operação.
