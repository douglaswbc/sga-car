import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { removeOrganizationMember, updateOrganizationMemberRole } from "@/features/organizations/actions";
import { inviteOrganizationMember, revokeOrganizationInvitation } from "@/features/organizations/invitation-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const roles = ["admin", "finance", "operations", "support"] as const;
const roleLabels: Record<(typeof roles)[number] | "owner", string> = {
  owner: "Proprietário",
  admin: "Administrador",
  finance: "Financeiro",
  operations: "Operações",
  support: "Atendimento",
};
type TeamPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function TeamPage({ searchParams }: Readonly<TeamPageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const organization = organizations?.find((item) => item.status === "active" && item.role === "owner");
  if (!organization) redirect("/");
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase.rpc("list_organization_members", { target_organization_id: organization.id }),
    supabase.rpc("list_organization_invitations", { target_organization_id: organization.id }),
  ]);

  const totalMembers = members?.length ?? 0;

  return <><header className="admin-header"><div><p className="eyebrow">Configurações</p><h1>Equipe — {organization.name}</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/comunicacao/canais">Canais e conexões</Link><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    <FormMessage tone="error">{params.error}</FormMessage>
    <FormMessage tone="notice">{params.notice}</FormMessage>
    <article className="panel"><header className="panel-header"><div><h2>Convidar membro</h2><p>Enviaremos um e-mail com um link seguro para a pessoa aceitar o convite.</p></div></header><form action={inviteOrganizationMember} className="member-form"><input name="organizationId" type="hidden" value={organization.id} /><label className="member-field" htmlFor="email">E-mail<input autoComplete="email" id="email" name="email" placeholder="nome@empresa.com" required type="email" /></label><label className="member-field" htmlFor="name">Nome (opcional)<input autoComplete="name" id="name" maxLength={160} name="name" placeholder="Como aparece no sistema" type="text" /></label><label className="member-field" htmlFor="role">Nível de acesso<select defaultValue="operations" id="role" name="role">{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><SubmitButton pendingLabel="Convidando…">Convidar por e-mail</SubmitButton></form></article>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Convites pendentes</h2><p>{invitations?.length ?? 0} convite(s) aguardando aceite.</p></div></header>{invitations?.length ? <div className="table-wrap"><table><thead><tr><th scope="col">E-mail</th><th scope="col">Nível de acesso</th><th scope="col">Expira em</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td><strong>{invitation.email}</strong></td><td>{roleLabels[invitation.role]}</td><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(invitation.expires_at))}</td><td><div className="member-role-form"><form action={inviteOrganizationMember}><input name="organizationId" type="hidden" value={organization.id} /><input name="email" type="hidden" value={invitation.email} /><input name="role" type="hidden" value={invitation.role} /><SubmitButton className="table-action" pendingLabel="Reenviando…">Reenviar</SubmitButton></form><form action={revokeOrganizationInvitation}><input name="organizationId" type="hidden" value={organization.id} /><input name="invitationId" type="hidden" value={invitation.id} /><SubmitButton className="table-action table-action--danger" pendingLabel="Revogando…">Revogar</SubmitButton></form></div></td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhum convite pendente. Convide alguém pelo formulário acima.</p>}</article>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Membros</h2><p>{totalMembers} {totalMembers === 1 ? "pessoa com acesso" : "pessoas com acesso"}. O proprietário da organização é protegido nesta tela.</p></div></header>{totalMembers ? <div className="table-wrap"><table><thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Nível de acesso</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{members?.map((member) => <tr key={member.user_id}><td><strong>{member.full_name || "Sem nome"}</strong>{member.user_id === user.id ? <small className="table-subtitle">Você</small> : null}</td><td>{member.email}</td><td>{member.role === "owner" ? <span className="status status--neutral"><span aria-hidden="true" />{roleLabels.owner}</span> : <form action={updateOrganizationMemberRole} className="member-role-form"><label className="sr-only" htmlFor={`role-${member.user_id}`}>Nível de acesso de {member.full_name}</label><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={member.user_id} /><select defaultValue={member.role} id={`role-${member.user_id}`} name="role">{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select><SubmitButton className="table-action" pendingLabel="Salvando…">Salvar</SubmitButton></form>}</td><td>{member.role !== "owner" ? <form action={removeOrganizationMember}><input name="organizationId" type="hidden" value={organization.id} /><input name="userId" type="hidden" value={member.user_id} /><SubmitButton aria-label={`Remover ${member.full_name || member.email} da equipe`} className="table-action table-action--danger" pendingLabel="Removendo…">Remover</SubmitButton></form> : <span className="member-protected">Protegido</span>}</td></tr>)}</tbody></table></div> : <p className="empty-state">Ainda não há membros adicionais. Adicione a primeira pessoa pelo formulário acima.</p>}</article>
  </section></>;
}
