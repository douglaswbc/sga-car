import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Gera `src/lib/supabase/ca.ts` a partir de `supabase-ca.pem`.
 *
 * O runtime do SGA é o Cloudflare Workers, que não tem sistema de arquivos: a CA raiz
 * do Supabase precisa entrar no bundle como constante. O `.pem` continua sendo a fonte
 * única da verdade — os scripts administrativos leem o arquivo diretamente, e este
 * espelho é regenerado com `npm run ca:sync` sempre que o `.pem` muda.
 */
const source = join(process.cwd(), "supabase-ca.pem");
const target = join(process.cwd(), "src", "lib", "supabase", "ca.ts");

const pem = readFileSync(source, "utf8").trim();
if (!pem.startsWith("-----BEGIN CERTIFICATE-----") || !pem.includes("-----END CERTIFICATE-----")) {
  throw new Error(`supabase-ca.pem não contém um certificado PEM válido.`);
}

const contents = `// Arquivo gerado por \`npm run ca:sync\`. Não edite à mão: altere \`supabase-ca.pem\`.
//
// A CA raiz do Supabase é pública — a mesma para todos os clientes — e fica embutida
// no bundle porque o runtime do Workers não tem sistema de arquivos para lê-la.

export const SUPABASE_ROOT_CA = \`${pem}\n\`;
`;

const unchanged = existsSync(target) && readFileSync(target, "utf8") === contents;
if (unchanged) {
  console.log("src/lib/supabase/ca.ts já está atualizado.");
} else {
  writeFileSync(target, contents);
  console.log("src/lib/supabase/ca.ts gerado a partir de supabase-ca.pem.");
}
