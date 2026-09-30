import { cache } from "react";
import { Pool } from "pg";
import { SUPABASE_ROOT_CA } from "@/lib/supabase/ca";

const RETRYABLE_CONNECTION_ERRORS = ["Connection terminated", "timeout exceeded", "ECONNRESET", "EPIPE", "ETIMEDOUT", "Client has encountered a connection error"];

function isRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_CONNECTION_ERRORS.some((candidate) => message.includes(candidate));
}

function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL precisa estar configurada para tarefas de servidor.");

  // Parâmetros de TLS são gerenciados pelo driver; removê-los evita duplicidade de config.
  const parsedDatabaseUrl = new URL(databaseUrl);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedDatabaseUrl.searchParams.delete(parameter);

  return new Pool({
    connectionString: parsedDatabaseUrl.toString(),
    // O pooler do Supabase usa uma CA privada ("Supabase Intermediate 2021 CA"), que não
    // está em nenhum trust store do sistema — sem esta âncora a verificação falha. A CA raiz
    // é pública e vem embutida no bundle porque o Workers não tem `node:fs`.
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 1,
    // Uma conexão por consulta. No Workers não há processo de longa duração, então reciclar
    // o mesmo socket entre requisições não é permitido e faz as requisições seguintes
    // falharem. O `pg-pool` remove e destrói o cliente ao atingir este limite.
    maxUses: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Transaction mode não aceita comandos de sessão; `pg` envia SET ao abrir conexão.
    options: "-c statement_timeout=15000",
  });
}

/**
 * Um pool por requisição.
 *
 * Dentro de um Server Component, `cache()` memoiza por requisição e todas as chamadas de
 * `query()` daquela requisição compartilham o mesmo pool. Fora de um render — route
 * handlers e o Cron Trigger — o React não tem escopo, então a fábrica roda a cada chamada
 * e cada `query()` recebe o seu; com `maxUses: 1` a conexão morre junto com a consulta e
 * nada fica pendurado.
 *
 * Manter o pool como singleton de módulo reutilizaria o socket entre requisições, que é
 * o que o runtime do Workers não permite.
 */
const getPool = cache(createPool);

export async function query<Row extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<Row[]> {
  const run = () => getPool().query(text, values).then((result) => result.rows as Row[]);
  try {
    return await run();
  } catch (error) {
    // A borda encerra sockets ociosos sem aviso. O primeiro erro é sempre de transporte,
    // nunca de SQL, então repetir é seguro: a transação anterior já foi revertida e o
    // `maxUses: 1` já descartou o cliente morto.
    if (!isRetryable(error)) throw error;
    return await run();
  }
}
