import { readFile } from "node:fs/promises";
import { Client } from "pg";

const email = process.argv[2]?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;
const certificatePath = process.env.DATABASE_CA_CERT_PATH;
if (!email) throw new Error("Informe o e-mail: npm run promote:master -- nome@dominio.com");
if (!databaseUrl || !certificatePath) throw new Error("DATABASE_URL e DATABASE_CA_CERT_PATH precisam estar configuradas.");

const parsedUrl = new URL(databaseUrl);
for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedUrl.searchParams.delete(parameter);
const client = new Client({ connectionString: parsedUrl.toString(), ssl: { ca: await readFile(certificatePath, "utf8"), rejectUnauthorized: true } });
await client.connect();
try {
  const { rows } = await client.query("select id from auth.users where lower(email) = $1 limit 1;", [email]);
  if (!rows[0]) throw new Error("Nenhuma conta com esse e-mail foi encontrada no Supabase Auth.");
  await client.query("insert into public.platform_administrators (user_id) values ($1) on conflict (user_id) do nothing;", [rows[0].id]);
  console.log("Conta promovida a master.");
} finally { await client.end(); }
