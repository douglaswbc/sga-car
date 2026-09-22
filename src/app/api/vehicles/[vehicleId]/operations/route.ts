import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ vehicleId: string }> };
const odometer = z.object({ action: z.literal("odometer"), organizationId: z.string().uuid(), recordedOn: z.string().date(), odometerKm: z.coerce.number().int().min(0), note: z.string().max(500).optional() });
const maintenance = z.object({ action: z.literal("maintenance"), organizationId: z.string().uuid(), type: z.enum(["preventive", "corrective"]), title: z.string().trim().min(2).max(200), scheduledOn: z.string().date(), scheduledOdometerKm: z.coerce.number().int().min(0).optional(), cost: z.coerce.number().min(0), notes: z.string().max(2000).optional() });
export async function POST(request: Request, { params }: Context) {
  const payload: unknown = await request.json().catch(() => null); const { vehicleId } = await params; const parsed = typeof payload === "object" && payload !== null && "action" in payload && payload.action === "maintenance" ? maintenance.safeParse(payload) : odometer.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const data = parsed.data; const result = data.action === "maintenance" ? await supabase.rpc("create_vehicle_maintenance", { target_organization_id: data.organizationId, target_vehicle_id: vehicleId, maintenance_type: data.type, maintenance_title: data.title, maintenance_scheduled_on: data.scheduledOn, maintenance_scheduled_odometer_km: data.scheduledOdometerKm ?? null, maintenance_cost: data.cost, maintenance_notes: data.notes ?? "" }) : await supabase.rpc("record_vehicle_odometer", { target_organization_id: data.organizationId, target_vehicle_id: vehicleId, entry_date: data.recordedOn, entry_odometer_km: data.odometerKm, entry_note: data.note ?? "" });
  if (result.error) return NextResponse.json({ error: "Não foi possível registrar a operação." }, { status: 409 }); return NextResponse.json({ ok: true }, { status: 201 });
}
