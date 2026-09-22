import { redirect } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { signOut } from "@/features/auth/actions";
import { requestOrganization } from "@/features/organizations/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OnboardingPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function OnboardingPage({ searchParams }: Readonly<OnboardingPageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const pendingOrganization = organizations?.find((organization) => organization.status === "pending");
  const activeOrganization = organizations?.find((organization) => organization.status === "active");
  if (activeOrganization) redirect("/");

  return (
    <main className="auth-shell"><section className="auth-card" aria-labelledby="onboarding-title">
      <div className="onboarding-brand-row"><p className="auth-brand">SGA <span>Gestão de aluguel</span></p><form action={signOut}><button className="account-sign-out" type="submit">Sair</button></form></div>
      <h1 id="onboarding-title">Criar organização</h1>
      <FormMessage tone="error">{params.error}</FormMessage>
      <FormMessage tone="notice">{params.notice}</FormMessage>
      {pendingOrganization ? <p className="auth-description">A organização <strong>{pendingOrganization.name}</strong> está aguardando aprovação de um administrador da plataforma.</p> : <><p className="auth-description">Informe o nome da sua locadora. A solicitação será revisada antes do acesso ser liberado.</p><form action={requestOrganization} className="auth-form"><label htmlFor="name">Nome da organização</label><input id="name" maxLength={120} name="name" required type="text" /><SubmitButton pendingLabel="Enviando…">Enviar solicitação</SubmitButton></form></>}
    </section></main>
  );
}
