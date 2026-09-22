"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setActiveOrganization(organizationId: string) {
  const parsed = z.string().uuid().safeParse(organizationId);
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();
  await supabase.rpc("set_active_organization", { target_organization_id: parsed.data });
  revalidatePath("/", "layout");
}
