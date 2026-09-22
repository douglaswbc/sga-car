import { NextResponse } from "next/server";
import { vehicleRegistrationSchema } from "@/features/fleet/vehicle-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsedVehicle = vehicleRegistrationSchema.safeParse(payload);
  if (!parsedVehicle.success) return NextResponse.json({ error: parsedVehicle.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const vehicle = parsedVehicle.data;
  const { error } = await supabase.rpc("create_vehicle", { target_organization_id: vehicle.organizationId, vehicle_plate: vehicle.plate, vehicle_brand: vehicle.brand, vehicle_model: vehicle.model, vehicle_category: vehicle.category, vehicle_model_year: vehicle.modelYear ?? null, vehicle_color: vehicle.color, vehicle_odometer_km: vehicle.odometerKm });
  if (error) return NextResponse.json({ error: "Não foi possível cadastrar. A placa pode já estar em uso nesta organização." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
