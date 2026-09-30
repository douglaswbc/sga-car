import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { supabaseSsl } from "./supabase-tls.mjs";

/**
 * Remove (ou restaura) a integração do WhatsApp via Zernio.
 *
 *   node --env-file=.env scripts/rollback-zernio.mjs --confirm            # remove
 *   node --env-file=.env scripts/rollback-zernio.mjs --restore --confirm   # restaura
 *
 * O DDL do Zernio faz parte de `0001_baseline.sql`, então restaurá-lo não é reexecutar o
 * baseline inteiro: isso falharia, porque o baseline declara as tabelas principais sem
 * `if not exists` e elas já existem. Em vez disso, extraímos do baseline apenas a seção
 * do Zernio, que é idempotente e pode ser reaplicada sobre o banco como está.
 */
const BASELINE = "0001_baseline.sql";
// O travessão final é obrigatório: sem ele o texto de "Origem:" no header do baseline
// casaria também, e a extração pegaria o trecho errado.
const SECTION_MARKER = "-- 202609160015_zernio_whatsapp.sql —";

const restore = process.argv.includes("--restore");
if (!process.argv.includes("--confirm")) {
  console.error(restore
    ? "Isto recria as tabelas da integração do Zernio. Rode novamente com --confirm."
    : "Esta operação é destrutiva. Rode novamente com --confirm para executar.");
  console.error(restore
    ? "Ela recria organization_zernio_connections, zernio_connect_sessions, zernio_inbound_messages e zernio_whatsapp_templates."
    : "Ela apaga essas mesmas quatro tabelas e as funções delas em todas as organizações, incluindo as API keys cifradas.");
  process.exit(1);
}

function readZernioSection() {
  const baseline = readFileSync(join(process.cwd(), "supabase", "migrations", BASELINE), "utf8");
  const start = baseline.indexOf(SECTION_MARKER);
  if (start === -1) throw new Error(`A seção ${SECTION_MARKER} não foi encontrada em ${BASELINE}.`);
  // A seção vai até o próximo cabeçalho de arquivo, que é o que a separa da anterior.
  const rest = baseline.slice(start);
  const nextSection = rest.slice(1).search(/\n-- \d{12}_\S+\.sql/);
  return nextSection === -1 ? rest : rest.slice(0, nextSection + 1);
}

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

  if (restore) {
    await client.query(readZernioSection());
    await client.query("commit");
    console.log("Integração do Zernio restaurada a partir de 0001_baseline.sql.");
  } else {
    const connections = await client.query("select count(*)::int as c from public.organization_zernio_connections");
    const inbound = await client.query("select count(*)::int as c from public.zernio_inbound_messages");
    console.log(`Removendo: ${connections.rows[0].c} conexão(ões) e ${inbound.rows[0].c} mensagem(ns) recebida(s).`);

    await client.query("drop table if exists public.zernio_inbound_messages");
    await client.query("drop table if exists public.zernio_connect_sessions");
    await client.query("drop table if exists public.organization_zernio_connections");
    await client.query("drop table if exists public.zernio_whatsapp_templates");

    await client.query("drop function if exists public.ensure_organization_zernio_whatsapp_templates(uuid)");
    await client.query("drop function if exists public.list_organization_zernio_whatsapp_templates(uuid)");
    await client.query("drop function if exists public.create_organization_zernio_whatsapp_template(uuid, text, text, text, text, jsonb)");
    await client.query("drop function if exists public.get_organization_zernio_connection_status(uuid)");
    await client.query("drop function if exists public.get_organization_zernio_webhook_status(uuid)");

    // `zernio` deixa de ser um modo de entrega válido.
    await client.query("update public.organization_messaging_settings set whatsapp_delivery = 'sga' where whatsapp_delivery = 'zernio'");
    await client.query("alter table public.organization_messaging_settings drop constraint if exists organization_messaging_settings_delivery_check");
    await client.query("alter table public.organization_messaging_settings add constraint organization_messaging_settings_delivery_check check (whatsapp_delivery in ('sga', 'n8n'))");
    await client.query("create or replace function public.set_organization_messaging_settings(target_organization_id uuid, delivery text) returns void language plpgsql security definer set search_path = public as $$ begin if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if; if delivery not in ('sga', 'n8n') then raise exception 'invalid delivery provider'; end if; insert into public.organization_messaging_settings (organization_id, whatsapp_delivery, updated_at) values (target_organization_id, delivery, now()) on conflict (organization_id) do update set whatsapp_delivery = excluded.whatsapp_delivery, updated_at = now(); end; $$");
    await client.query("revoke all on function public.set_organization_messaging_settings(uuid, text) from public");
    await client.query("grant execute on function public.set_organization_messaging_settings(uuid, text) to authenticated");

    await client.query("commit");
    console.log("Rollback concluído. Restaure com \"npm run rollback:zernio -- --restore --confirm\".");
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
