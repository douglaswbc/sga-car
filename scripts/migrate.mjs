import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const databaseCaCertificatePath = process.env.DATABASE_CA_CERT_PATH;

if (!databaseUrl) {
  throw new Error("DATABASE_URL precisa estar configurada para executar migrations.");
}

if (!databaseCaCertificatePath) {
  throw new Error(
    "DATABASE_CA_CERT_PATH precisa apontar para o certificado raiz do Supabase.",
  );
}

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const databaseCaCertificate = await readFile(databaseCaCertificatePath, "utf8");
const parsedDatabaseUrl = new URL(databaseUrl);

// The pg connection-string parser lets sslmode override the explicit TLS
// options below. TLS is configured here so the downloaded Supabase CA is
// always used for certificate verification.
for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
  parsedDatabaseUrl.searchParams.delete(parameter);
}

const client = new Client({
  connectionString: parsedDatabaseUrl.toString(),
  ssl: { ca: databaseCaCertificate, rejectUnauthorized: true },
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

    const sql = await readFile(join(migrationsDirectory, migrationFile), "utf8");
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
