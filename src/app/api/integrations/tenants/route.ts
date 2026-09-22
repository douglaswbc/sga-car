import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateApiToken } from "@/lib/integrations/api-token";

export const runtime = "nodejs";

type TenantRow = { id: string; full_name: string; document_number: string | null; email: string | null; phone: string | null; status: string; created_at: string };

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request, "tenants:read");
  if ("response" in auth) return auth.response;

  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 200;
  const rows = await query<TenantRow>(
    `select id, full_name, document_number, email, phone, status, created_at
     from public.tenants where organization_id = $1 order by full_name limit $2`,
    [auth.context.organizationId, limit],
  );
  return NextResponse.json({ tenants: rows });
}
