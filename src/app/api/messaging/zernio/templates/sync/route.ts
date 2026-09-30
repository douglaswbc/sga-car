import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { readZernioConnection } from "@/lib/messaging/providers/whatsapp-zernio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createWhatsAppTemplate, listWhatsAppTemplates, ZernioApiError } from "@/features/zernio/api-client";

export const runtime = "nodejs";

const schema = z.object({ direction: z.enum(["push", "pull"]), organizationId: z.string().uuid() });

type LocalTemplate = { id: string; name: string; body: string; status: string; category: string; language: string; body_examples: string[] };
type RemoteTemplate = { id: string; name: string; status: string; rejected_reason?: string; rejectedReason?: string };

// A Meta devolve estados em maiúsculas (APPROVED, PENDING, REJECTED); a coluna do SGA
// guarda em minúsculas. Qualquer estado fora da lista vira "unknown" para o SGA decidir.
const allowedStatus = new Set(["pending", "approved", "rejected", "paused", "disabled"]);
const normalizeStatus = (value: string) => {
  const status = value.toLowerCase();
  return allowedStatus.has(status) ? status : "unknown";
};

/** A Zernio valida o nome com ^[a-z][a-z0-9_]*$; nomes de exibição do SGA podem ter espaços e maiúsculas. */
function providerTemplateName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : null;
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitação inválida." }, { status: 422 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const allowed = organizations?.some((org) => org.id === parsed.data.organizationId && org.status === "active" && ["owner", "admin"].includes(org.role));
  if (!allowed) return NextResponse.json({ error: "Acesso restrito ao owner/admin da organização." }, { status: 403 });

  let connection: { apiKey: string; accountId: string };
  try {
    connection = await readZernioConnection(parsed.data.organizationId);
  } catch {
    return NextResponse.json({ error: "Configure a conexão do Zernio desta organização antes de sincronizar." }, { status: 409 });
  }

  try {
    if (parsed.data.direction === "pull") {
      const remote = await listWhatsAppTemplates(connection.apiKey, connection.accountId);
      const templates = remote.templates ?? remote.data ?? [];
      for (const template of templates as RemoteTemplate[]) {
        await query(
          `update public.zernio_whatsapp_templates
             set status = $3, zernio_template_id = $4, rejection_reason = $5, last_synced_at = now()
           where organization_id = $1 and name = $2`,
          [parsed.data.organizationId, template.name, normalizeStatus(template.status), template.id, template.rejected_reason ?? template.rejectedReason ?? null],
        );
      }
      return NextResponse.json({ ok: true, synchronized: templates.length });
    }

    const local = await query<LocalTemplate>(
      "select id, name, body, status, category, language, body_examples from public.zernio_whatsapp_templates where organization_id = $1 and status in ('local', 'rejected') order by scheduled_at",
      [parsed.data.organizationId],
    );

    let submitted = 0;
    const failures: string[] = [];
    for (const template of local) {
      const providerName = providerTemplateName(template.name);
      if (!providerName) {
        failures.push(`${template.name}: nome inválido para a API do Zernio.`);
        continue;
      }
      try {
        await createWhatsAppTemplate(connection.apiKey, {
          accountId: connection.accountId,
          name: providerName,
          category: template.category,
          language: template.language,
          parameterFormat: "POSITIONAL",
          components: template.body_examples.length ? [{ type: "BODY", text: template.body, example: { body_text: [template.body_examples] } }] : [{ type: "BODY", text: template.body }],
        });
        await query("update public.zernio_whatsapp_templates set status = 'pending', rejection_reason = null, last_synced_at = now() where id = $1", [template.id]);
        submitted += 1;
      } catch (error) {
        failures.push(`${template.name}: ${error instanceof Error ? error.message : "falha"}`);
      }
    }
    return NextResponse.json({ ok: failures.length === 0, submitted, failures });
  } catch (error) {
    if (error instanceof ZernioApiError) return NextResponse.json({ error: `O Zernio recusou a operação: ${error.message}` }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar templates." }, { status: 502 });
  }
}
