import { Suspense } from "react";
import { signOut } from "@/features/auth/actions";
import { ROLE_LABELS, type OrganizationRole } from "@/features/auth/permissions";
import { NavLinks } from "@/components/nav-links";
import { ToastProvider } from "@/components/toast";
import { OrganizationSwitcher } from "@/features/organizations/organization-switcher";

type Props = {
  user: { email: string | null; fullName: string | null };
  organization: { id: string; name: string; role: OrganizationRole } | null;
  organizations: { id: string; name: string }[];
  isMaster: boolean;
  children: React.ReactNode;
};

export function AppShell({ user, organization, organizations, isMaster, children }: Readonly<Props>) {
  const displayName = user.fullName ?? user.email ?? "Usuário";
  const initials = displayName.slice(0, 2).toUpperCase();
  const accountLabel = organization ? ROLE_LABELS[organization.role] : "Administrador da plataforma";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand-copy">SGA<small>Gestão de aluguel</small></span>
        </div>
        {organization && organizations.length > 1 ? <OrganizationSwitcher activeId={organization.id} organizations={organizations} /> : null}
        <Suspense fallback={<nav aria-hidden="true" />}>
          <NavLinks isMaster={isMaster} role={organization?.role ?? null} />
        </Suspense>
        <div className="account">
          <div className="avatar">{initials}</div>
          <div className="account-details">
            <strong>{displayName}</strong>
            <small>{accountLabel}</small>
          </div>
          <form action={signOut}>
            <button aria-label="Sair da conta" className="account-sign-out" title="Sair">Sair</button>
          </form>
        </div>
      </aside>
      <section className="workspace">
        <ToastProvider>{children}</ToastProvider>
      </section>
    </main>
  );
}
