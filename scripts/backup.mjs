import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireDatabaseUrl } from "./supabase-tls.mjs";

const databaseUrl = requireDatabaseUrl();

const directory = process.env.BACKUP_DIR ?? "backups";
mkdirSync(directory, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(directory, `sga-${stamp}.dump`);

const result = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", target, databaseUrl],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error || result.status !== 0) {
  console.error("Falha ao executar pg_dump. Instale o cliente PostgreSQL (pg_dump) e confirme o acesso.");
  process.exit(1);
}

console.log(`Backup gerado em ${target}`);
