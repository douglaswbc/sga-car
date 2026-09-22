import { NextResponse } from "next/server";
import { inspectionSchema } from "@/features/contracts/inspection-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ contractId: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { contractId } = await params; const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data, error } = await supabase.rpc("list_contract_inspections", { target_organization_id: new URL(_request.url).searchParams.get("organizationId") ?? "", target_contract_id: contractId });
  if (error) return NextResponse.json({ error: "Não foi possível consultar as vistorias." }, { status: 409 });
  return NextResponse.json({ inspections: data });
}
export async function POST(request: Request, { params }: Context) {
  const payload: unknown = await request.json().catch(() => null); const { contractId } = await params;
  const parsed = inspectionSchema.safeParse({ ...(typeof payload === "object" && payload !== null ? payload : {}), contractId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const value = parsed.data; const { error } = await supabase.rpc("upsert_contract_inspection", { target_organization_id: value.organizationId, target_contract_id: contractId, inspection_type: value.type, inspection_date: value.inspectedOn, inspection_odometer_km: value.odometerKm, inspection_fuel_level: value.fuelLevel, inspection_accessories: value.accessories, inspection_notes: value.notes ?? "", inspection_photo_urls: value.photoUrls, inspection_damages: value.damages });
  if (error) return NextResponse.json({ error: "Não foi possível salvar a vistoria. A vistoria de retirada é obrigatória antes da devolução." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
