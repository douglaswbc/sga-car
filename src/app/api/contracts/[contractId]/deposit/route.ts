import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };

const setSchema = z.object({ organizationId: z.string().uuid(), amount: z.coerce.number().min(0).max(9_999_999) });
const actionSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["charge", "settle"]),
  dueOn: z.string().date().optional(),
  description: z.string().trim().max(500).optional(),
  resolution: z.enum(["refunded", "retained"]).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function PUT(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = setSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("set_contract_deposit", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    deposit_amount: parsed.data.amount,
  });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar a caução." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.deposit_set", entityType: "rental_contract", entityId: contractId, summary: `Caução definida em ${parsed.data.amount}`, metadata: { amount: parsed.data.amount } });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });

  if (parsed.data.action === "charge") {
    if (!parsed.data.dueOn) return NextResponse.json({ error: "Informe o vencimento da caução." }, { status: 422 });
    const { error } = await supabase.rpc("charge_contract_deposit", {
      target_organization_id: parsed.data.organizationId,
      target_contract_id: contractId,
      deposit_due_on: parsed.data.dueOn,
      deposit_description: parsed.data.description ?? "Caução",
    });
    if (error) return NextResponse.json({ error: "Não foi possível gerar a cobrança da caução." }, { status: 409 });
    await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.deposit_charged", entityType: "rental_contract", entityId: contractId, summary: "Cobrança da caução gerada", metadata: { dueOn: parsed.data.dueOn } });
    return NextResponse.json({ ok: true });
  }

  if (!parsed.data.resolution) return NextResponse.json({ error: "Informe a resolução da caução." }, { status: 422 });
  const { error } = await supabase.rpc("settle_contract_deposit", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    deposit_resolution: parsed.data.resolution,
    deposit_note: parsed.data.note ?? "",
  });
  if (error) return NextResponse.json({ error: "Não foi possível encerrar a caução." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.deposit_settled", entityType: "rental_contract", entityId: contractId, summary: `Caução encerrada como ${parsed.data.resolution}` });
  return NextResponse.json({ ok: true });
}
