import { Pool } from "pg";
import { SUPABASE_ROOT_CA } from "@/lib/supabase/ca";

const RETRYABLE_CONNECTION_ERRORS = ["Connection terminated", "timeout exceeded", "ECONNRESET", "EPIPE", "ETIMEDOUT", "Client has encountered a connection error"];

let pool: Pool | undefined;

function isRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_CONNECTION_ERRORS.some((candidate) => message.includes(candidate));
}

/**
 * O runtime do SGA roda em Cloudflare Workers, onde não existe processo persistente:
 * o pool precisa se recuperar de sockets derrubados pela borda a cada invocação.
 * O pooler em transaction mode (:6543) é obrigatório aqui, porque a session mode (:5432)
 * seguraria uma sessão dedicada por request e esgotaria o `max_connections` do Supabase.
 */
function getPool() {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL precisa estar configurada para tarefas de servidor.");

  // Parâmetros de TLS são gerenciados pelo driver; removê-los evita duplicidade de config.
  const parsedDatabaseUrl = new URL(databaseUrl);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedDatabaseUrl.searchParams.delete(parameter);

  pool = new Pool({
    connectionString: parsedDatabaseUrl.toString(),
    // O pooler do Supabase usa uma CA privada ("Supabase Intermediate 2021 CA"), que não
    // está em nenhum trust store do sistema — sem esta âncora a verificação falha. A CA raiz
    // é pública e vem embutida no bundle porque o Workers não tem `node:fs`.
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Transaction mode não aceita comandos de sessão; `pg` envia SET ao abrir conexão.
    options: "-c statement_timeout=15000",
  });
  // Um Client ocioso não pode impedir o isolate de ser descartado pela borda.
  pool.on("error", () => {
    pool = undefined;
  });
  return pool;
}

export async function query<Row extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<Row[]> {
  try {
    const result = await getPool().query(text, values);
    return result.rows as Row[];
  } catch (error) {
    // A borda encerra sockets ociosos sem aviso; o primeiro erro é sempre de transporte,
    // nunca de SQL, então uma repetição é segura (a transação anterior já foi revertida).
    if (!isRetryable(error)) throw error;
    pool = undefined;
    const result = await getPool().query(text, values);
    return result.rows as Row[];
  }
}
