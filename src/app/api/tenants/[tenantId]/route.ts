import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantUpdateSchema } from "@/features/tenants/tenant-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string }> };
const deleteSchema = z.object({ organizationId: z.string().uuid() });

export async function PATCH(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { tenantId } = await params;
  const body = typeof payload === "object" && payload !== null ? payload : {};
  const parsed = tenantUpdateSchema.safeParse({ ...body, tenantId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const tenant = parsed.data;
  const { error } = await supabase.rpc("update_tenant", {
    target_organization_id: tenant.organizationId,
    target_tenant_id: tenant.tenantId,
    tenant_full_name: tenant.fullName,
    tenant_document_number: tenant.documentNumber,
    tenant_email: tenant.email,
    tenant_phone: tenant.phone,
    tenant_status: tenant.status,
  });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar. Verifique se o documento ou telefone já estão em uso." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { tenantId } = await params;
  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(tenantId).success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("delete_tenant", { target_organization_id: parsed.data.organizationId, target_tenant_id: tenantId });
  if (error) {
    const message = error.message.includes("history") ? "Locatário possui contratos ou faturas. Inative-o em vez de excluir." : "Não foi possível excluir o locatário.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
