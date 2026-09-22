import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string }> };
const schema = z.object({ organizationId: z.string().uuid() });

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { tenantId } = await params;
  const parsed = schema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });

  const { error } = await supabase.rpc("anonymize_tenant", {
    target_organization_id: parsed.data.organizationId,
    target_tenant_id: tenantId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível anonimizar o titular." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
