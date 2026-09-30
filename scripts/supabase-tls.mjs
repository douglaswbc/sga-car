import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A CA raiz do Supabase é pública (a mesma para todos os clientes) e versionada no
 * repositório. Ela precisa de caminho fixo porque o runtime do Workers não tem
 * sistema de arquivos: a variável de ambiente apontaria para um arquivo que não
 * existe no bundle. Rode `npm run ca:sync` para regerar o espelho em
 * `src/lib/supabase/ca.ts` quando o `.pem` mudar.
 */
const CA_PATH = join(process.cwd(), "supabase-ca.pem");

export function readSupabaseCa() {
  return readFileSync(CA_PATH, "utf8");
}

/**
 * Monta a configuração de TLS. A validação não pode ser desligada: o pooler usa uma CA
 * privada que não está em nenhum trust store do sistema, então a âncora explícita é o
 * que garante que este é mesmo o servidor do Supabase.
 */
export function supabaseSsl() {
  return { ca: readSupabaseCa(), rejectUnauthorized: true };
}

/** `DATABASE_URL` é a única URL do projeto: transaction mode (:6543) serve app e scripts. */
export function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL precisa estar configurada (use node --env-file=.env).");
  }
  return databaseUrl;
}
