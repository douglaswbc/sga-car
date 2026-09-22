import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ contractId: string }> };

const createSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2, "Informe o nome da taxa.").max(120),
  amount: z.coerce.number().positive("A taxa deve ser maior que zero.").max(9_999_999),
  recurrence: z.enum(["one_time", "recurring"]),
});
const deleteSchema = z.object({ organizationId: z.string().uuid(), feeId: z.string().uuid() });

export async function GET(request: Request, { params }: RouteContext) {
  const { contractId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!z.string().uuid().safeParse(organizationId).success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data, error } = await supabase.rpc("list_contract_fees", {
    target_organization_id: organizationId as string,
    target_contract_id: contractId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível carregar as taxas." }, { status: 409 });
  return NextResponse.json({ fees: data ?? [] });
}

export async function POST(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: parsed.success ? "Dados inválidos." : parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("add_contract_fee", {
    target_organization_id: parsed.data.organizationId,
    target_contract_id: contractId,
    fee_name: parsed.data.name,
    fee_amount: parsed.data.amount,
    fee_recurrence: parsed.data.recurrence,
  });
  if (error) return NextResponse.json({ error: "Não foi possível adicionar a taxa." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.fee_added", entityType: "contract_fee", entityId: contractId, summary: `Taxa "${parsed.data.name}" adicionada`, metadata: { amount: parsed.data.amount, recurrence: parsed.data.recurrence } });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null);
  const { contractId } = await params;
  const parsed = deleteSchema.safeParse(payload);
  if (!parsed.success || !z.string().uuid().safeParse(contractId).success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("remove_contract_fee", {
    target_organization_id: parsed.data.organizationId,
    target_fee_id: parsed.data.feeId,
  });
  if (error) return NextResponse.json({ error: "Não foi possível remover a taxa." }, { status: 409 });
  await recordAudit(supabase, { organizationId: parsed.data.organizationId, action: "contract.fee_removed", entityType: "contract_fee", entityId: parsed.data.feeId, summary: "Taxa removida" });
  return NextResponse.json({ ok: true });
}
