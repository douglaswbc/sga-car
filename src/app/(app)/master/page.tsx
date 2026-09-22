import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { approveOrganization, reactivateOrganization, suspendOrganization } from "@/features/organizations/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MasterPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function MasterPage({ searchParams }: Readonly<MasterPageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isMaster } = await supabase.rpc("is_platform_administrator");
  if (!isMaster) redirect("/");
  const [{ data: organizations }, { data: activeOrganizations }, { data: suspendedOrganizations }] = await Promise.all([
    supabase.rpc("list_pending_organizations"),
    supabase.rpc("list_active_organizations"),
    supabase.rpc("list_suspended_organizations"),
  ]);

  return (
    <><header className="admin-header"><div><p className="eyebrow">Administração da plataforma</p><h1>Solicitações de organizações</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/comunicacao/canais">Comunicação e conexões</Link><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
      <FormMessage tone="error">{params.error}</FormMessage>
      <FormMessage tone="notice">{params.notice}</FormMessage>
      <article className="panel"><header className="panel-header"><div><h2>Pendentes de aprovação</h2><p>Ative somente organizações verificadas.</p></div></header>
        {organizations?.length ? <div className="table-wrap"><table><thead><tr><th>Organização</th><th>Solicitante</th><th>Solicitada em</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{organizations.map((organization) => <tr key={organization.id}><td><strong>{organization.name}</strong></td><td>{organization.owner_name}</td><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(organization.created_at))}</td><td><form action={approveOrganization}><input name="organizationId" type="hidden" value={organization.id} /><SubmitButton className="table-action" pendingLabel="Aprovando…">Aprovar</SubmitButton></form></td></tr>)}</tbody></table></div> : <p className="empty-state">Não há solicitações pendentes.</p>}
      </article>
      <article className="panel admin-panel"><header className="panel-header"><div><h2>Organizações ativas</h2><p>Suspender remove o acesso operacional até nova aprovação.</p></div></header>
        {activeOrganizations?.length ? <div className="table-wrap"><table><thead><tr><th>Organização</th><th>Proprietário</th><th>Criada em</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{activeOrganizations.map((organization) => <tr key={organization.id}><td><strong>{organization.name}</strong></td><td>{organization.owner_name}</td><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(organization.created_at))}</td><td><form action={suspendOrganization}><input name="organizationId" type="hidden" value={organization.id} /><SubmitButton className="table-action table-action--danger" pendingLabel="Suspendendo…">Suspender</SubmitButton></form></td></tr>)}</tbody></table></div> : <p className="empty-state">Não há organizações ativas.</p>}
      </article>
      <article className="panel admin-panel"><header className="panel-header"><div><h2>Organizações suspensas</h2><p>Reative somente após regularização.</p></div></header>
        {suspendedOrganizations?.length ? <div className="table-wrap"><table><thead><tr><th>Organização</th><th>Proprietário</th><th>Criada em</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{suspendedOrganizations.map((organization) => <tr key={organization.id}><td><strong>{organization.name}</strong></td><td>{organization.owner_name}</td><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(organization.created_at))}</td><td><form action={reactivateOrganization}><input name="organizationId" type="hidden" value={organization.id} /><SubmitButton className="table-action" pendingLabel="Reativando…">Reativar</SubmitButton></form></td></tr>)}</tbody></table></div> : <p className="empty-state">Não há organizações suspensas.</p>}
      </article>
    </section></>
  );
}
