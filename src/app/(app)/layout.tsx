import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSessionContext } from "@/features/auth/session";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, isMaster, organization, organizations } = await getSessionContext();

  if (!user) redirect("/login");
  if (!isMaster && !organization) {
    redirect(organizations.some((item) => item.status === "suspended") ? "/acesso-suspenso" : "/onboarding");
  }

  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  return (
    <AppShell
      isMaster={isMaster}
      organization={organization ? { id: organization.id, name: organization.name, role: organization.role } : null}
      organizations={organizations.filter((item) => item.status === "active").map((item) => ({ id: item.id, name: item.name }))}
      user={{ email: user.email ?? null, fullName }}
    >
      {children}
    </AppShell>
  );
}
