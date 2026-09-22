import { NextResponse } from "next/server";
import { z } from "zod";
import { rentalContractUpdateSchema } from "@/features/contracts/contract-schema";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };
const deleteSchema = z.object({ organizationId: z.string().uuid() });

export async function PATCH(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null); const { contractId } = await params; const parsed = rentalContractUpdateSchema.safeParse({ ...payload, contractId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const contract = parsed.data;
  const { error } = await supabase.rpc("update_rental_contract", { target_organization_id: contract.organizationId, target_contract_id: contract.contractId, contract_expected_return_on: contract.expectedReturnOn, contract_daily_rate: contract.dailyRate, contract_billing_frequency: contract.billingFrequency, contract_billing_time: contract.billingTime, contract_billing_custom_interval: contract.billingFrequency === "custom" ? contract.customInterval ?? null : null, contract_billing_custom_unit: contract.billingFrequency === "custom" ? contract.customUnit ?? null : null, contract_status: contract.status, contract_actual_return_on: contract.status === "active" ? null : (contract.actualReturnOn || null) });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar o contrato." }, { status: 409 });
  await recordAudit(supabase, { organizationId: contract.organizationId, action: "contract.updated", entityType: "rental_contract", entityId: contractId, summary: "Contrato atualizado", metadata: { status: contract.status } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null); const parsed = deleteSchema.safeParse(payload); const { contractId } = await params;
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("delete_rental_contract", { target_organization_id: parsed.data.organizationId, target_contract_id: contractId });
  if (error) return NextResponse.json({ error: "Contratos ativos não podem ser excluídos; conclua ou cancele primeiro." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.deleted", entityType: "rental_contract", entityId: contractId, summary: "Contrato excluído" });
  return NextResponse.json({ ok: true });
}
