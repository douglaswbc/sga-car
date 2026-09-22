import { NextResponse } from "next/server";
import { messageTemplateSchema } from "@/features/messaging/messaging-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = messageTemplateSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const template = parsed.data;
  const { error } = await supabase.rpc("upsert_message_template", {
    target_organization_id: template.organizationId,
    template_channel: template.channel,
    template_event: template.event,
    template_subject: template.subject,
    template_body: template.body,
    template_provider_name: template.providerTemplateName,
    template_provider_language: template.providerTemplateLanguage,
  });
  if (error) return NextResponse.json({ error: "Não foi possível salvar o template." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
