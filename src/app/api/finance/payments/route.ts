import { NextResponse } from "next/server";
import { paymentSchema } from "@/features/finance/finance-schema";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null); const parsed = paymentSchema.safeParse(payload); if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 }); const payment = parsed.data;
  const { error } = await supabase.rpc("record_invoice_payment", { target_organization_id: payment.organizationId, target_invoice_id: payment.invoiceId, payment_paid_on: payment.paidOn, payment_amount: payment.amount, payment_method: payment.method, payment_receipt_url: payment.receiptUrl ?? "", payment_note: payment.note ?? "" });
  if (error) return NextResponse.json({ error: "Não foi possível registrar o pagamento. Confira o saldo em aberto." }, { status: 409 }); await recordAudit(supabase, { organizationId: payment.organizationId, action: "payment.recorded", entityType: "payment", entityId: payment.invoiceId, summary: `Pagamento de ${payment.amount} registrado`, metadata: { invoiceId: payment.invoiceId, method: payment.method } }); return NextResponse.json({ ok: true }, { status: 201 });
}
