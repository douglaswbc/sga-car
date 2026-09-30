import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gera o baseline do schema concatenando as migrations em ordem de nome.
 *
 * Só faz sentido com o banco ainda vazio: depois que há dados reais, reescrever o
 * histórico de `sga_schema_migrations` perde a capacidade de auditar quando cada mudança
 * entrou. Ver docs/database.md.
 */
const directory = join(process.cwd(), "supabase", "migrations");
const target = "0001_baseline.sql";

const files = readdirSync(directory)
  .filter((file) => file.endsWith(".sql") && file !== target)
  .sort();

if (files.length === 0) {
  console.log("Nada para consolidar.");
  process.exit(0);
}

const header = [
  "-- Baseline do schema do SGA.",
  "--",
  "-- Gerado por `npm run db:baseline`, que concatena as migrations na ordem de nome.",
  "-- Unificar só é seguro enquanto o banco não tem dado real: o histórico em",
  "-- public.sga_schema_migrations perde a capacidade de dizer quando cada mudança entrou.",
  "--",
  `-- Origem: ${files.length} migrations, de ${files[0]} a ${files[files.length - 1]}.`,
  "--",
  "-- A ordem importa e não pode ser reordenada: tipos antes de colunas que os usam,",
  "-- tabelas antes de policies e funções que as referenciam.",
  "",
].join("\n");

const sections = files.map((file) => {
  const body = readFileSync(join(directory, file), "utf8").trim();
  const title = file.replace(/^\d+_/, "").replace(/\.sql$/, "").replace(/_/g, " ");
  return `-- ${"-".repeat(76)}\n-- ${file} — ${title}\n-- ${"-".repeat(76)}\n\n${body}`;
});

writeFileSync(join(directory, target), `${header}\n${sections.join("\n\n")}\n`);
console.log(`${target} gerado a partir de ${files.length} migrations.`);
console.log("Apague os arquivos de origem e reconcilie o histórico com `npm run db:baseline:apply`.");
