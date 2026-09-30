import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { supabaseSsl } from "./supabase-tls.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL precisa estar configurada para executar migrations.");
}

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const parsedDatabaseUrl = new URL(databaseUrl);

// The pg connection-string parser lets sslmode override the explicit TLS
// options below. TLS is configured here so the bundled Supabase CA is
// always used for certificate verification.
for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
  parsedDatabaseUrl.searchParams.delete(parameter);
}

const client = new Client({
  connectionString: parsedDatabaseUrl.toString(),
  ssl: supabaseSsl(),
});

await client.connect();

try {
  await client.query(`
    create table if not exists public.sga_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query("select name from public.sga_schema_migrations;");
  const appliedMigrations = new Set(rows.map((row) => row.name));

  for (const migrationFile of migrationFiles) {
    if (appliedMigrations.has(migrationFile)) continue;

    // Editores no Windows às vezes gravam BOM, e o Postgres rejeita com 42601 na posição 1 —
    // um erro que não aponta para o arquivo. Remover aqui evita a diagnóstico confuso.
    const sql = (await readFile(join(migrationsDirectory, migrationFile), "utf8")).replace(/^\uFEFF/, "");
    await client.query("begin");

    try {
      await client.query(sql);
      await client.query(
        "insert into public.sga_schema_migrations (name) values ($1);",
        [migrationFile],
      );
      await client.query("commit");
      console.log(`Migration aplicada: ${migrationFile}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
