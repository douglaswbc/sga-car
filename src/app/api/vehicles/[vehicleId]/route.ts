import { NextResponse } from "next/server";
import { z } from "zod";
import { vehicleUpdateSchema } from "@/features/fleet/vehicle-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ vehicleId: string }> };
const deleteSchema = z.object({ organizationId: z.string().uuid() });

export async function PATCH(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null); const { vehicleId } = await params;
  const parsed = vehicleUpdateSchema.safeParse({ ...payload, vehicleId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const vehicle = parsed.data;
  const { error } = await supabase.rpc("update_vehicle", { target_organization_id: vehicle.organizationId, target_vehicle_id: vehicle.vehicleId, vehicle_plate: vehicle.plate, vehicle_brand: vehicle.brand, vehicle_model: vehicle.model, vehicle_category: vehicle.category, vehicle_model_year: vehicle.modelYear ?? null, vehicle_color: vehicle.color, vehicle_odometer_km: vehicle.odometerKm, vehicle_status: vehicle.status });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar. Verifique se a placa já está em uso." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const payload = await request.json().catch(() => null); const parsed = deleteSchema.safeParse(payload); const { vehicleId } = await params;
  if (!parsed.success || !z.string().uuid().safeParse(vehicleId).success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("delete_vehicle", { target_organization_id: parsed.data.organizationId, target_vehicle_id: vehicleId });
  if (error) return NextResponse.json({ error: "Não foi possível excluir o veículo." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
