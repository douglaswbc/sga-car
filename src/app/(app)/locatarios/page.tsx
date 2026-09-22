import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageOperations } from "@/features/auth/permissions";
import { TenantActions } from "@/features/tenants/tenant-actions";
import { TenantWizard } from "@/features/tenants/tenant-wizard";
import { formatDocument, formatPhone } from "@/features/tenants/registration-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TenantsPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function TenantsPage({ searchParams }: Readonly<TenantsPageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const organization = organizations?.find((item) => item.status === "active");
  if (!organization) redirect("/");
  const { data: tenants } = await supabase.rpc("list_tenants", { target_organization_id: organization.id });
  const canManage = canManageOperations(organization.role);

  return <><header className="admin-header"><div><p className="eyebrow">Operação</p><h1>Locatários — {organization.name}</h1></div><div className="topbar-actions">{canManage ? <TenantWizard organizationId={organization.id} /> : null}<Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    {params.error ? <p className="form-message form-message--error" role="alert">{params.error}</p> : null}
    {params.notice ? <p className="form-message form-message--notice" role="status">{params.notice}</p> : null}
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Locatários cadastrados</h2><p>{tenants?.length ?? 0} registro(s).</p></div></header>{tenants?.length ? <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Documento</th><th>Contato</th><th>Status</th><th>Elegibilidade</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{tenants.map((tenant) => <tr key={tenant.id}><td><strong>{tenant.full_name}</strong></td><td>{tenant.document_number ? formatDocument(tenant.document_number) : "—"}</td><td><div className="tenant-contact">{tenant.phone ? <span>{formatPhone(tenant.phone)}</span> : null}{tenant.email ? <small>{tenant.email}</small> : null}{!tenant.phone && !tenant.email ? "—" : null}</div></td><td><span className={tenant.status === "active" ? "status status--success" : "status status--neutral"}><span aria-hidden="true" />{tenant.status === "active" ? "Ativo" : "Inativo"}</span></td><td><span className={tenant.is_eligible ? "status status--success" : "status status--warning"}><span aria-hidden="true" />{tenant.is_eligible ? "Apto" : "Pendente"}</span></td><td><a className="table-action" href={`/locatarios/${tenant.id}`}>Detalhe</a>{canManage ? <TenantActions organizationId={organization.id} tenant={tenant} /> : null}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhum locatário cadastrado.</p>}</article>
  </section></>;
}
