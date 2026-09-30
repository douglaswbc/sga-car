import { Client } from "pg";
import { supabaseSsl } from "./supabase-tls.mjs";

/**
 * Reescreve o histórico de `sga_schema_migrations` para refletir o baseline único.
 *
 * Só executa quando o schema do banco já corresponde ao baseline — que é o caso depois
 * de as 55 migrations terem sido aplicadas. O objetivo é apenas trocar o registro de
 * "55 arquivos aplicados" por "1 baseline aplicado", para que o runner não tente
 * reaplicar tudo. Nenhum dado é tocado: só a tabela de controle.
 *
 *   node --env-file=.env scripts/baseline-reconcile.mjs --confirm
 *
 * Sem `--confirm` nada é executado.
 */
const confirmed = process.argv.includes("--confirm");
if (!confirmed) {
  console.error("Isto reescreve o histórico de migrations. Rode com --confirm para executar.");
  process.exit(1);
}

const BASELINE = "0001_baseline.sql";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL precisa estar configurada (use node --env-file=.env).");
}
const parsedDatabaseUrl = new URL(databaseUrl);
for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedDatabaseUrl.searchParams.delete(parameter);

const client = new Client({ connectionString: parsedDatabaseUrl.toString(), ssl: supabaseSsl() });
await client.connect();

try {
  await client.query("begin");
  const before = await client.query("select name from public.sga_schema_migrations order by name");
  if (before.rows.some((row) => row.name === BASELINE)) {
    await client.query("rollback");
    console.log(`O histórico já aponta para ${BASELINE}. Nada a fazer.`);
    process.exit(0);
  }
  await client.query("delete from public.sga_schema_migrations");
  await client.query("insert into public.sga_schema_migrations (name) values ($1)", [BASELINE]);
  await client.query("commit");
  console.log(`Histórico reescrito: ${before.rows.length} entradas -> ${BASELINE}.`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
