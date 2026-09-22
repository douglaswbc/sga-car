# Implantação na VPS

## Componentes

- **Caddy** expõe somente as portas 80 e 443, gera e renova o certificado TLS.
- **Next.js** implementa a interface e o backend do SGA; ele não é exposto diretamente à internet.
- **PostgreSQL** armazena os dados e só é acessível na rede Docker interna.

Os serviços são definidos em `compose.yml`. Os volumes `postgres_data` e `caddy_data` são persistentes e não devem ser removidos durante atualizações.

## Pré-requisitos

- VPS Linux com Docker Engine e Docker Compose Plugin instalados.
- Domínio com registro A/AAAA apontando para o IP público da VPS.
- Firewall liberando apenas TCP 80 e TCP/UDP 443. Não exponha a porta do PostgreSQL.

## Primeira implantação

1. Clone o repositório na VPS e entre na pasta do projeto.
2. Copie `.env.example` para `.env`.
3. Preencha `APP_DOMAIN`, `POSTGRES_PASSWORD`, `DATABASE_URL` e `AUTH_SECRET`. A senha em `DATABASE_URL` deve ser idêntica a `POSTGRES_PASSWORD`.
4. Suba os serviços com `docker compose up -d --build`.
5. Valide com `docker compose ps` e `docker compose logs -f app`.

Para testar sem domínio, configure `APP_DOMAIN=:80`; o Caddy responderá sem TLS. Isso não é adequado para produção.

## Atualização

```bash
git pull
docker compose up -d --build
```

Não use `docker compose down -v`: essa opção remove o volume do banco.

## Backup e restauração

Execute o backup na VPS e guarde o arquivo fora dela, em armazenamento criptografado:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > sga-$(date +%F).dump
```

Para restaurar, interrompa o aplicativo, crie um backup atual e então execute:

```bash
docker compose stop app
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < sga-AAAA-MM-DD.dump
docker compose start app
```

Teste periodicamente uma restauração em uma VPS ou banco isolado. O backup é responsabilidade da operação da VPS.
