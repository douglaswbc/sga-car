# Implantação

O SGA é implantado como um **Cloudflare Worker** e usa o **Supabase** como banco de dados oficial. Não há container, VPS ou reverse proxy gerenciado por este projeto.

## Componentes

- **Cloudflare Worker** executa a aplicação Next.js empacotada pelo [OpenNext](https://opennext.js.org/cloudflare). A borda termina o TLS e serve os assets estáticos.
- **Supabase Postgres** armazena os dados. O SGA não mantém banco próprio.
- **Supabase Auth** autentica os usuários. O acesso do Worker usa a *publishable key*, nunca `service_role`.
- **Cron Trigger** da Cloudflare dispara o processamento da fila de mensagens a cada 15 minutos.

## Conexão com o banco

Uma única variável, `DATABASE_URL`, apontando para o Supavisor em **transaction mode** (porta 6543). Ela serve tanto a aplicação quanto as migrations e scripts administrativos.

Transaction mode e não session mode (5432) porque o SGA roda em Cloudflare Workers: a session mode segura uma sessão dedicada do Postgres por isolate, e o pool padrão do Supabase (20) seria esgotado — requests ficariam enfileirados por até um minuto.

A migration runner usa `BEGIN`/`COMMIT` explícitos e statements sem nome, que é o que a transaction mode aceita. O que ela **não** aceita são prepared statements nomeados, `SET`, `LISTEN/NOTIFY` e tabelas temporárias entre transações — nada disso é usado no projeto.

### TLS

O pooler do Supabase é assinado por uma **CA privada** ("Supabase Intermediate 2021 CA"), que não está em nenhum trust store do sistema:

```
$ openssl s_client -connect aws-0-<regiao>.pooler.supabase.com:6543 …
issuer = CN=Supabase Intermediate 2021 CA, O=Supabase Inc
```

Por isso a CA raiz pública está versionada em `supabase-ca.pem` e **a validação nunca é desligada**. Ela é embutida no bundle a partir de `src/lib/supabase/ca.ts`, porque o runtime do Workers não tem sistema de arquivos para ler um caminho. Se a raiz mudar:

```bash
npm run ca:sync
```

`rejectUnauthorized: false` quebraria a garantia de que a conexão é realmente com o Supabase. Não é aceitável aqui.

## Primeira implantação

### 1. Banco

Crie o projeto no Supabase e aplique as migrations:

```bash
cp .env.example .env
# preencha DATABASE_URL, NEXT_PUBLIC_SUPABASE_*, AUTH_SECRET e INTEGRATION_ENCRYPTION_KEY
npm run migrate
```

A raiz do certificado do banco já vem versionada em `supabase-ca.pem` — não há nada para baixar. Se precisar atualizá-la, substitua o arquivo e rode `npm run ca:sync`.

### 2. Segredos

Cada segredo vai para a Cloudflare como *secret*. Nada disso deve ir em `wrangler.jsonc` nem ser prefixado com `NEXT_PUBLIC_`:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put INTEGRATION_ENCRYPTION_KEY
npx wrangler secret put MESSAGING_DISPATCH_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SGA_EMAIL_FROM
```

Gere a chave mestra com `openssl rand -base64 32`. **Trocar `INTEGRATION_ENCRYPTION_KEY` invalida todas as credenciais de organização já gravadas** — elas são cifradas com AES-256-GCM e a chave é derivada por HKDF a partir desse valor.

`ZERNIO_API_BASE_URL` **não** é segredo: é uma URL pública e fica em `vars`, no `wrangler.jsonc`.

> **Use `secret put`, não o campo `vars`.** Uma variável em texto no `vars` é exposta no painel e o `wrangler` a imprime no diff de configuração a cada deploy. Foi assim que a senha do `DATABASE_URL` apareceu em claro no log de build.

### 3. Nome do Worker

O `name` em `wrangler.jsonc` **precisa** ser idêntico ao Worker criado no dashboard. O Workers Builds detecta a divergência, sobrescreve o campo com `WRANGLER_CI_OVERRIDE_NAME` e tenta abrir um pull request para corrigir.

Enquanto houver divergência, qualquer `services` que aponte para o nome antigo derruba o deploy:

```
Service binding 'WORKER_SELF_REFERENCE' references Worker 'sga-v2' which was not found [code: 10143]
```

O service binding de `worker.ts` referencia o próprio Worker, então os dois nomes precisam ser trocados juntos.

### 4. Deploy

Antes de publicar, troque `NEXT_PUBLIC_SITE_URL` em `wrangler.jsonc` pela URL real do Worker (`https://sga.<subdomain>.workers.dev`, ou o domínio próprio). Esse valor monta o retorno do callback de conexão do Zernio, a URL do webhook e os links dos e-mails.

```bash
npm run deploy -- -- --keep-vars
```

O `--keep-vars` impede que o deploy apague as *vars* configuradas no dashboard que não estejam em `wrangler.jsonc`. Ele não protege secrets — a Cloudflare nunca apaga secrets em um deploy, com ou sem a flag.

> O build do OpenNext usa `fs.symlink` e **não roda no Windows sem Developer Mode ou privilégio de administrador**, e o WSL não é substituto automático. Em Windows, use a integração com Git da Cloudflare (que compila em Linux) ou rode em WSL/Docker.

### 5. Onde cada variável precisa estar

`NEXT_PUBLIC_*` é um caso especial: o Next.js substitui o acesso por um **literal em tempo de build**, inclusive nos chunks de **servidor**. Depois do build, o código já não consulta mais `process.env` para essas chaves — ele devolve uma constante embutida:

```js
function c(){return "https://sga.<subdomain>.workers.dev".replace(/\/$/,"")}
```

Duas consequências:

- Definir essas variáveis **depois** do deploy não corrige nada. O valor errado fica congelado no bundle.
- A entrada equivalente no `vars` do `wrangler.jsonc` é **inerte** para o código do Worker. Ela não substitui a build variable e não deve ser tratada como se configurasse algo.

Então:

- **Deploy local (`npm run deploy`):** o `next build` carrega o `.env`, então `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` chegam ao bundle.
- **Integração com Git da Cloudflare:** elas vão em **Build variables and secrets** no painel do Workers Builds, não em Secrets. Sem isso o bundle fica com `undefined` e o login no Supabase quebra sem erro visível.

As demais (`DATABASE_URL`, `INTEGRATION_ENCRYPTION_KEY`, `MESSAGING_DISPATCH_TOKEN`, `RESEND_API_KEY`, `SGA_EMAIL_FROM`) são lidas em runtime e podem ser definidas depois do deploy, desde que antes de tráfego real.

## Atualização

```bash
git pull
npm run deploy -- -- --keep-vars
```

## Processamento da fila de mensagens

O SGA não roda agendador interno: o Worker não tem processo de longa duração, então `setInterval` não sobreviveria. O `Cron Trigger` declarado em `wrangler.jsonc` chama `POST /api/messaging/dispatch` a cada 15 minutos, autenticado por `MESSAGING_DISPATCH_TOKEN`.

O handler está em `worker.ts` e reentra pelo próprio `fetch` do Worker (via *service binding*) — o contexto de request do OpenNext, onde as bindings são resolvidas, só existe dentro de `fetch`.

Para testar localmente, com o agendador habilitado:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*"
```

## Backup

O banco é do Supabase. Use o backup gerenciado do próprio Supabase (PITR) e, para cópias pontuais, `npm run backup` a partir de uma máquina com `pg_dump` instalado. Restaure com `npm run restore <arquivo.dump>`.

Teste a restauração periodicamente em um banco isolado. O backup é responsabilidade da operação.
