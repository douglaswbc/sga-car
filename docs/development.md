# Desenvolvimento local

## Banco no Supabase

O Supabase é o banco oficial do SGA, e há **uma única URL**: `DATABASE_URL`, apontando para o Supavisor em **transaction mode** (porta 6543). Ela serve a aplicação, as migrations e os scripts administrativos.

Copie em **Connect → Connection string → URI** a URL de transaction mode. Codifique percentualmente a senha: caracteres como `&`, `#`, `?` e espaço quebram a URL. Não use o prefixo `NEXT_PUBLIC_`.

Transaction mode e não session mode porque o SGA roda em Workers: a session mode seguraria uma sessão dedicada do Postgres por isolate e esgotaria o pool do Supabase.

### Certificado

A CA raiz do Supabase é **pública** (a mesma para todos os clientes) e versionada em `supabase-ca.pem`. Não existe variável de ambiente para ela: o runtime do Workers não tem sistema de arquivos para ler um caminho.

Os scripts administrativos leem o `.pem` diretamente; a aplicação usa o espelho `src/lib/supabase/ca.ts`, gerado do `.pem`. Se a raiz mudar:

```bash
npm run ca:sync
```

O pooler usa uma CA privada que não está em nenhum trust store do sistema, então essa âncora é obrigatória. A validação do certificado nunca é desligada.

### Chaves de serviço

`AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY` e `MESSAGING_DISPATCH_TOKEN` são gerados uma vez e vivem no `.env` local e nos segredos do Worker:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Regenerar é seguro **enquanto não houver nada cifrado**. `INTEGRATION_ENCRYPTION_KEY` deriva a chave de AES-256-GCM que protege as API keys da Zernio: trocá-la torna as credenciais já gravadas indecifráveis e elas precisam ser informadas de novo. `MESSAGING_DISPATCH_TOKEN` é comparado em tempo constante com o header do Cron Trigger, então o valor do `.env` precisa ser idêntico ao do segredo no Worker.

`AUTH_SECRET` não é lido por nenhum código do projeto — a autenticação usa Supabase Auth com cookies, via `@supabase/ssr`. A variável existe por convenção e pode ser gerada sem consequência.

## Migrations

```bash
npm run migrate
```

O runner aplica cada arquivo de `supabase/migrations/` ainda não registrado em `sga_schema_migrations`, um por transação.

O schema completo está em `0001_baseline.sql` (gerado por `npm run db:baseline`, não editado à mão). Alterações novas entram como migrations pequenas **depois** dele, com a sequência global continuando.

O runner remove BOM antes de enviar o SQL: editores no Windows às vezes gravam BOM, e o Postgres responde `42601` na posição 1, sem dizer qual arquivo foi.

A integração do Zernio mora no baseline e é idempotente de propósito: cria com `if not exists`, garante colunas com `add column if not exists`, remove com `if exists` e redefine funções com `create or replace` (precedido de `drop` quando a assinatura muda). Isso permite reaplicá-la com segurança depois de um rollback parcial, coisa que um arquivo dividido em vários não garantiria — o runner marca por nome e uma falha no meio deixaria o histórico inconsistente.

## Rollback da integração do Zernio

Para refazer a integração do zero — mudança de schema, credencial comprometida, ou rollback de desenvolvimento:

```bash
npm run rollback:zernio            # mostra o aviso e não executa nada
npm run rollback:zernio -- --confirm
```

Apaga `organization_zernio_connections`, `zernio_connect_sessions`, `zernio_inbound_messages` e `zernio_whatsapp_templates`, remove as funções, devolve o modo de entrega para `sga`/`n8n` e **libera a migration para ser reaplicada** com `npm run migrate`.

É destrutivo: as API keys cifradas das organizações são perdidas. Os modelos de mensagem globais são preservados porque `npm run migrate` os recria.

O comando exige `--confirm` porque o efeito é irreversível nas organizações.

## Desenvolvimento e Workers

`npm run dev` para o dia a dia. `src/lib/db.ts` usa o mesmo caminho de produção: pool de uma conexão, com retentativa quando a borda derruba o socket.

Para testar no runtime real do Worker, use `npm run preview`. Com o agendador habilitado:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*"
```

Variáveis locais do Worker ficam em `.dev.vars` (modelo em `.dev.vars.example`, fora do Git). Rode `npm run cf-typegen` depois de alterar `wrangler.jsonc` para regenerar `cloudflare-env.d.ts`.

> `cloudflare-env.d.ts` **não** entra no `tsconfig.json` principal: ele troca os tipos de `fetch`/`Response` do DOM pelos do runtime Workers, o que faz `Response.json()` retornar `unknown` e derruba o typecheck da aplicação. Os tipos do Worker vivem em `tsconfig.worker.json`, e `npm run typecheck` roda os dois projetos.

## Validação

```bash
npm run lint
npm run typecheck
npm run build
```

> O build do OpenNext (`npm run preview`/`npm run deploy`) usa `fs.symlink` e **não roda no Windows sem Developer Mode ou privilégio de administrador**. Em Windows, use a integração com Git da Cloudflare (compila em Linux) ou rode em WSL/Docker.
