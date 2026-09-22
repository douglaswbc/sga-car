import { readFileSync } from "node:fs";
import { Pool } from "pg";

let pool: Pool | undefined;

function getPool() {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL precisa estar configurada para tarefas de servidor.");
  const certificatePath = process.env.DATABASE_CA_CERT_PATH;
  const parsedDatabaseUrl = new URL(databaseUrl);
  for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedDatabaseUrl.searchParams.delete(parameter);
  const certificate = certificatePath ? readFileSync(certificatePath, "utf8") : undefined;
  pool = new Pool({
    connectionString: parsedDatabaseUrl.toString(),
    ssl: certificate ? { ca: certificate, rejectUnauthorized: true } : false,
    max: 5,
  });
  return pool;
}

export async function query<Row extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await getPool().query(text, values);
  return result.rows as Row[];
}
