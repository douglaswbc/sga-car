import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string; documentId: string }> };
const deleteSchema = z.object({ organizationId: z.string().uuid() });

export async function DELETE(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { tenantId, documentId } = await params;
  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(tenantId).success || !z.string().uuid().safeParse(documentId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("delete_tenant_document", {
    target_organization_id: parsed.data.organizationId,
    target_tenant_id: tenantId,
    target_document_id: documentId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível remover o documento." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
