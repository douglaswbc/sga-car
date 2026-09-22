import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrganizationMembership } from "@/lib/supabase/types";

export type SessionContext = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  user: User | null;
  isMaster: boolean;
  organizations: OrganizationMembership[];
  organization: OrganizationMembership | null;
};

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: isMaster }, { data: organizations }] = await Promise.all([
    supabase.rpc("is_platform_administrator"),
    supabase.rpc("get_my_organizations"),
  ]);
  const memberships = organizations ?? [];

  return {
    supabase,
    user,
    isMaster: Boolean(isMaster),
    organizations: memberships,
    organization: memberships.find((item) => item.status === "active") ?? null,
  };
}
