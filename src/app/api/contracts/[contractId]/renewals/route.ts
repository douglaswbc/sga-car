import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };

const extendSchema = z.object({
  organizationId: z.string().uuid(),
  newReturnOn: z.string().date("Informe a nova previsão de retorno."),
  newDailyRate: z.coerce.number().positive("A diária deve ser maior que zero.").max(9_999_999).optional(),
});

export async function GET(request: Request, { params }: RouteContext) {
  const { contractId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data, error } = await supabase.rpc("list_contract_renewals", {
    target_organization_id: organizationId as string,
    target_contract_id: contractId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 409 });
  return NextResponse.json({ renewals: data ?? [] });
}

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = extendSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: parsed.success ? "Dados inválidos." : parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("extend_rental_contract", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    new_return_on: parsed.data.newReturnOn,
    new_daily_rate: parsed.data.newDailyRate ?? null,
  });
  if (error) return NextResponse.json({ error: "Não foi possível prorrogar o contrato. A nova data deve ser posterior à atual." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.renewed", entityType: "rental_contract", entityId: contractId, summary: `Contrato prorrogado para ${parsed.data.newReturnOn}`, metadata: { newReturnOn: parsed.data.newReturnOn, newDailyRate: parsed.data.newDailyRate ?? null } });
  return NextResponse.json({ ok: true }, { status: 201 });
}
