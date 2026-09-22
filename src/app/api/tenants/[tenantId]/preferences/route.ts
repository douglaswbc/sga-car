import { NextResponse } from "next/server";
import { tenantPreferencesSchema } from "@/features/messaging/messaging-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { tenantId } = await params;
  const parsed = tenantPreferencesSchema.safeParse({ ...(typeof payload === "object" && payload !== null ? payload : {}), tenantId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const preference = parsed.data;
  const { error } = await supabase.rpc("upsert_tenant_preferences", {
    target_organization_id: preference.organizationId,
    target_tenant_id: preference.tenantId,
    preference_email_opt_in: preference.emailOptIn,
    preference_whatsapp_opt_in: preference.whatsappOptIn,
    preference_consent: preference.consent,
  });
  if (error) return NextResponse.json({ error: "Não foi possível salvar as preferências." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
