import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };

const settleSchema = z.object({
  organizationId: z.string().uuid(),
  actualReturnOn: z.string().date("Informe a data de devolução."),
  dueOn: z.string().date().optional(),
});

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = settleSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: parsed.success ? "Dados inválidos." : parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("settle_contract_return", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    target_actual_return_on: parsed.data.actualReturnOn,
    settlement_due_on: parsed.data.dueOn ?? parsed.data.actualReturnOn,
  });
  if (error) return NextResponse.json({ error: "Não foi possível encerrar o contrato com acerto." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.settled", entityType: "rental_contract", entityId: contractId, summary: `Contrato encerrado com acerto em ${parsed.data.actualReturnOn}`, metadata: { actualReturnOn: parsed.data.actualReturnOn } });
  return NextResponse.json({ ok: true });
}
