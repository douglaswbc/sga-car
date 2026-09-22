# Administração da plataforma

## Papéis

- `master` administra a plataforma inteira e fica em `platform_administrators`.
- `owner`, `admin`, `finance`, `operations` e `support` pertencem somente a uma organização.

`master` não é um papel de `organization_members`. Isso impede que a administração global seja concedida por uma organização comum.

## Aprovação de organizações

Uma conta autenticada pode solicitar uma organização. A solicitação cria a organização com status `pending` e torna o solicitante `owner`. Apenas um `master` pode mudar o status para `active`; ele também pode suspendê-la.

## Primeiro master

Depois de criar e confirmar a sua conta, execute no terminal:

```bash
npm run promote:master -- seu-email@dominio.com
```

O comando procura a conta no Supabase Auth e grava apenas o seu identificador em `platform_administrators`. Execute-o somente para uma conta verificada e sob seu controle.
