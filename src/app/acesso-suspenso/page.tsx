import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SuspendedAccessPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const suspendedOrganization = organizations?.find((organization) => organization.status === "suspended");
  if (!suspendedOrganization) redirect("/");
  return <main className="auth-shell"><section className="auth-card"><div className="onboarding-brand-row"><p className="auth-brand">SGA <span>Gestão de aluguel</span></p><form action={signOut}><button className="account-sign-out" type="submit">Sair</button></form></div><h1>Acesso suspenso</h1><p className="auth-description">O acesso da organização <strong>{suspendedOrganization.name}</strong> está temporariamente suspenso. Fale com o administrador da plataforma para regularizar.</p></section></main>;
}
