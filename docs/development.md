# Desenvolvimento local

## Banco no Supabase

O desenvolvimento local não requer Docker. Crie um projeto no Supabase e, no painel **Connect**, copie a URL do **Session Pooler** (porta 5432) para `DATABASE_URL` no `.env`. Preserve `sslmode=verify-full` e não use o prefixo `NEXT_PUBLIC_`.

No mesmo painel, baixe o certificado raiz do banco e salve-o localmente como `supabase-ca.crt`. Defina `DATABASE_CA_CERT_PATH=./supabase-ca.crt` no `.env`. Esse certificado é necessário para `npm run migrate` validar a conexão TLS; ele é ignorado pelo Git e pelo Docker.

O SGA se conecta a PostgreSQL padrão. Assim, as migrations que forem adicionadas ao repositório poderão ser aplicadas tanto no projeto Supabase quanto no PostgreSQL autogerenciado da VPS. O Supabase é temporariamente o host do banco, não uma dependência do código ou das regras de negócio.

Nesta fase ainda não há migrations. O SQL Editor do Supabase pode ser usado para criar e inspecionar tabelas durante o desenvolvimento. Para executar a interface localmente, use:

```bash
npm run dev
```

## Implantação futura na VPS

Na VPS, o `compose.yml` mantém um PostgreSQL privado próprio. Nesse momento, substitua `DATABASE_URL` pela URL interna `postgresql://<usuário>:<senha>@postgres:5432/<banco>` e preencha as variáveis `POSTGRES_*` do `.env`.
