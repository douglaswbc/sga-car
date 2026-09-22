import { NextResponse } from "next/server";
import { tenantDocumentSchema } from "@/features/tenants/tenant-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { tenantId } = await params;
  const body = typeof payload === "object" && payload !== null ? payload : {};
  const parsed = tenantDocumentSchema.safeParse({ ...body, tenantId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const document = parsed.data;
  const { error } = await supabase.rpc("add_tenant_document", {
    target_organization_id: document.organizationId,
    target_tenant_id: document.tenantId,
    document_type: document.type,
    document_name: document.name,
    document_url: document.url,
    document_identifier: document.identifier,
    document_category: document.category,
    document_expires_on: document.expiresOn || null,
  });
  if (error) return NextResponse.json({ error: "Não foi possível salvar o documento." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
