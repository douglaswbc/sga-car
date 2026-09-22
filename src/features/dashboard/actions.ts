"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reportSchema = z.object({ name: z.string().trim().min(1).max(80), startsOn: z.string().date(), endsOn: z.string().date() }).refine((value) => value.startsOn <= value.endsOn, { message: "Período inválido." });

export async function saveDashboardReport(organizationId: string, formData: FormData) {
  const parsed = reportSchema.safeParse({ name: formData.get("name"), startsOn: formData.get("starts_on"), endsOn: formData.get("ends_on") });
  if (!parsed.success) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("save_dashboard_report", { target_organization_id: organizationId, report_name: parsed.data.name, period_starts_on: parsed.data.startsOn, period_ends_on: parsed.data.endsOn });
  revalidatePath("/");
}
