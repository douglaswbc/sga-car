import { NextResponse } from "next/server";
import { z } from "zod";
import { pullMetaWhatsAppTemplates, pushMetaWhatsAppTemplate } from "@/lib/messaging/meta-templates";
import { query } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decryptConnectionSecret } from "@/lib/messaging/connection-crypto";

const requestSchema = z.object({ direction: z.enum(["push", "pull"]), organizationId: z.string().uuid() });
type LocalTemplate = { id: string; name: string; body: string; status: string; category: "UTILITY" | "MARKETING" | "AUTHENTICATION"; language: string; body_examples: string[] };
type RemoteTemplate = { id: string; name: string; status: string; rejected_reason?: string };
const allowedStatus = new Set(["pending", "approved", "rejected", "paused", "disabled"]);
const normalizeStatus = (value: string) => allowedStatus.has(value.toLowerCase()) ? value.toLowerCase() : "unknown";

async function requireManager(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("AUTH");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  if (!organizations?.some((organization) => organization.id === organizationId && organization.status === "active" && ["owner", "admin"].includes(organization.role))) throw new Error("FORBIDDEN");
}
async function applyPull(organizationId: string, templates: RemoteTemplate[]) {
  for (const template of templates) {
    await query("update public.meta_whatsapp_templates set status = $3, meta_template_id = $4, rejection_reason = $5, last_synced_at = now() where organization_id = $1 and name = $2", [organizationId, template.name, normalizeStatus(template.status), template.id, template.rejected_reason ?? null]);
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitação inválida." }, { status: 422 });
  try { await requireManager(parsed.data.organizationId); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "AUTH" ? "Autenticação obrigatória." : "Acesso restrito ao owner/admin da organização." }, { status: error instanceof Error && error.message === "AUTH" ? 401 : 403 }); }
  try {
    const connections = await query<{ business_account_id: string; access_token_ciphertext: string }>("select business_account_id, access_token_ciphertext from public.organization_whatsapp_connections where organization_id = $1", [parsed.data.organizationId]);
    if (!connections.length) return NextResponse.json({ error: "Configure a conexão Meta desta organização antes de sincronizar." }, { status: 409 });
    const connection = { businessAccountId: connections[0].business_account_id, accessToken: decryptConnectionSecret(connections[0].access_token_ciphertext) };
    if (parsed.data.direction === "pull") {
      const remote = await pullMetaWhatsAppTemplates(connection); await applyPull(parsed.data.organizationId, remote);
      return NextResponse.json({ ok: true, synchronized: remote.length });
    }
    const local = await query<LocalTemplate>("select id, name, body, status, category, language, body_examples from public.meta_whatsapp_templates where organization_id = $1 and status in ('local', 'rejected') order by scheduled_at", [parsed.data.organizationId]);
    let submitted = 0; const failures: string[] = [];
    for (const template of local) {
      try { await pushMetaWhatsAppTemplate(connection, template); await query("update public.meta_whatsapp_templates set status = 'pending', rejection_reason = null, last_synced_at = now() where id = $1", [template.id]); submitted += 1; }
      catch (error) { failures.push(`${template.name}: ${error instanceof Error ? error.message : "falha"}`); }
    }
    return NextResponse.json({ ok: failures.length === 0, submitted, failures });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar templates." }, { status: 502 }); }
}
