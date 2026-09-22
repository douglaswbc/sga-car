import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBrazilMobile } from "@/features/tenants/registration-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const querySchema = z.object({ organizationId: z.string().uuid(), phone: z.string() });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({ organizationId: url.searchParams.get("organizationId"), phone: url.searchParams.get("phone") });
  if (!parsedQuery.success) return NextResponse.json({ error: "Consulta inválida." }, { status: 400 });
  const phone = normalizeBrazilMobile(parsedQuery.data.phone);
  if (!/^\d{2}9\d{8}$/.test(phone)) return NextResponse.json({ exists: false });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data, error } = await supabase.rpc("tenant_phone_exists", { target_organization_id: parsedQuery.data.organizationId, tenant_phone: phone });
  if (error) return NextResponse.json({ error: "Não foi possível verificar o telefone." }, { status: 403 });
  return NextResponse.json({ exists: data });
}
