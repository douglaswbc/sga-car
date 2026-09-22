import { NextResponse } from "next/server";
import { rentalContractSchema } from "@/features/contracts/contract-schema";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null); const parsed = rentalContractSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const contract = parsed.data;
  const { data: created, error } = await supabase.rpc("create_rental_contract", { target_organization_id: contract.organizationId, target_tenant_id: contract.tenantId, target_vehicle_id: contract.vehicleId, contract_starts_on: contract.startsOn, contract_expected_return_on: contract.expectedReturnOn, contract_daily_rate: contract.dailyRate, contract_billing_frequency: contract.billingFrequency, contract_billing_time: contract.billingTime, contract_billing_custom_interval: contract.billingFrequency === "custom" ? contract.customInterval ?? null : null, contract_billing_custom_unit: contract.billingFrequency === "custom" ? contract.customUnit ?? null : null });
  if (error) return NextResponse.json({ error: "Não foi possível criar o contrato. Confirme que o veículo continua disponível." }, { status: 409 });
  if (created && contract.depositAmount && contract.depositAmount > 0) {
    await supabase.rpc("set_contract_deposit", { target_organization_id: contract.organizationId, target_contract_id: created.id, deposit_amount: contract.depositAmount });
  }
  await recordAudit(supabase, { organizationId: contract.organizationId, action: "contract.created", entityType: "rental_contract", entityId: created?.id ?? null, summary: "Contrato de locação criado", metadata: { vehicleId: contract.vehicleId, tenantId: contract.tenantId } });
  return NextResponse.json({ ok: true }, { status: 201 });
}
