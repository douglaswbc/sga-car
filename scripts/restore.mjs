import { spawnSync } from "node:child_process";
import { requireDatabaseUrl } from "./supabase-tls.mjs";

const databaseUrl = requireDatabaseUrl();
const file = process.argv[2];

if (!file) {
  console.error("Informe o caminho do backup: node --env-file=.env scripts/restore.mjs backups/sga-....dump");
  process.exit(1);
}

const result = spawnSync(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", databaseUrl, file],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error || result.status !== 0) {
  console.error("Falha ao executar pg_restore. Confirme o arquivo e o acesso ao banco.");
  process.exit(1);
}

console.log(`Restauração concluída a partir de ${file}.`);
