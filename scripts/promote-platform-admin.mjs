import { Client } from "pg";
import { supabaseSsl } from "./supabase-tls.mjs";

const email = process.argv[2]?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;
if (!email) throw new Error("Informe o e-mail: npm run promote:master -- nome@dominio.com");
if (!databaseUrl) throw new Error("DATABASE_URL precisa estar configurada.");

const parsedUrl = new URL(databaseUrl);
for (const parameter of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) parsedUrl.searchParams.delete(parameter);
const client = new Client({ connectionString: parsedUrl.toString(), ssl: supabaseSsl() });
await client.connect();
try {
  const { rows } = await client.query("select id from auth.users where lower(email) = $1 limit 1;", [email]);
  if (!rows[0]) throw new Error("Nenhuma conta com esse e-mail foi encontrada no Supabase Auth.");
  await client.query("insert into public.platform_administrators (user_id) values ($1) on conflict (user_id) do nothing;", [rows[0].id]);
  console.log("Conta promovida a master.");
} finally { await client.end(); }
