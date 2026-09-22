# Configuração do Supabase Auth

## Variáveis do aplicativo

No painel Supabase, abra **Connect** e copie a URL do projeto e a **Publishable key**. No `.env`, defina:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<chave>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

A publishable key pode estar no navegador. Não use `SUPABASE_SECRET_KEY` nem `service_role` no aplicativo cliente.

## Configuração no painel

1. Em **Authentication > Providers > Email**, habilite o provedor Email.
2. Mantenha confirmação de e-mail habilitada para produção.
3. Em **Authentication > URL Configuration**, defina a Site URL como `http://localhost:3000` durante o desenvolvimento.
4. Adicione `http://localhost:3000/**` às Redirect URLs permitidas.
5. Quando houver domínio de produção, substitua a Site URL por `https://seu-dominio` e adicione `https://seu-dominio/**` às Redirect URLs.

## Modelo de e-mail de confirmação

Em **Authentication > Email Templates > Confirm signup**, use um link que aponte para a rota de confirmação do aplicativo:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Confirmar e-mail</a>
```

Essa rota valida o token no servidor e grava a sessão em cookie HTTP-only.

## Onboarding de organização

Após um usuário autenticado chamar `POST /api/onboarding/organization` com o corpo abaixo, a função `create_organization` cria a organização e associa o usuário atual como `owner` em uma única transação:

```json
{ "name": "Minha locadora" }
```

A rota valida a entrada com Zod, valida a sessão pelo Supabase Auth e não aceita um `user_id` enviado pelo cliente.
