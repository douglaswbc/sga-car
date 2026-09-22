import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateApiToken } from "@/lib/integrations/api-token";

export const runtime = "nodejs";

type ContractRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  vehicle_id: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_plate: string;
  starts_on: string;
  expected_return_on: string;
  actual_return_on: string | null;
  daily_rate: number;
  status: string;
};

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request, "contracts:read");
  if ("response" in auth) return auth.response;

  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 100;
  const rows = await query<ContractRow>(
    `select contract.id, contract.tenant_id, tenant.full_name as tenant_name, contract.vehicle_id,
            vehicle.brand as vehicle_brand, vehicle.model as vehicle_model, vehicle.plate as vehicle_plate,
            contract.starts_on, contract.expected_return_on, contract.actual_return_on, contract.daily_rate, contract.status
     from public.rental_contracts contract
     join public.tenants tenant on tenant.id = contract.tenant_id
     join public.vehicles vehicle on vehicle.id = contract.vehicle_id
     where contract.organization_id = $1
     order by contract.created_at desc limit $2`,
    [auth.context.organizationId, limit],
  );
  return NextResponse.json({ contracts: rows });
}
