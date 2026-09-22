import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };

const schema = z.object({
  organizationId: z.string().uuid(),
  role: z.enum(["tenant", "company"]),
  name: z.string().trim().min(2, "Informe o nome do signatário.").max(160),
  document: z.string().trim().max(40).optional(),
});

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = schema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: parsed.success ? "Dados inválidos." : parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("sign_rental_contract", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    signer_role: parsed.data.role,
    signer_name: parsed.data.name,
    signer_document: parsed.data.document ?? "",
  });
  if (error) return NextResponse.json({ error: "Não foi possível registrar a assinatura." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
