import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { tenantId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });

  const { data, error } = await supabase.rpc("export_tenant_data", {
    target_organization_id: organizationId as string,
    target_tenant_id: tenantId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível exportar os dados do titular." }, { status: 409 });

  return new NextResponse(JSON.stringify(data ?? {}, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="titular-${tenantId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
