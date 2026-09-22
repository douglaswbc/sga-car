import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateApiToken } from "@/lib/integrations/api-token";

export const runtime = "nodejs";

type InvoiceRow = {
  id: string;
  contract_id: string | null;
  tenant_id: string;
  tenant_name: string;
  due_on: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  description: string | null;
};

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request, "invoices:read");
  if ("response" in auth) return auth.response;

  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 100;
  const rows = await query<InvoiceRow>(
    `select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name as tenant_name, invoice.due_on,
            invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description
     from public.invoices invoice
     join public.tenants tenant on tenant.id = invoice.tenant_id
     where invoice.organization_id = $1
     order by invoice.due_on desc limit $2`,
    [auth.context.organizationId, limit],
  );
  return NextResponse.json({ invoices: rows });
}
