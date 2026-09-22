import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageTemplates } from "@/features/auth/permissions";
import { TemplateManager } from "@/features/messaging/template-manager";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MessageTemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const organization = organizations?.find((item) => item.status === "active");
  if (!organization) redirect("/");
  const canManage = canManageTemplates(organization.role);
  if (!canManage) redirect("/");
  const { data: templates } = await supabase.rpc("list_message_templates", { target_organization_id: organization.id });

  return <><header className="admin-header"><div><p className="eyebrow">Comunicação</p><h1>Templates de mensagem — {organization.name}</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/comunicacao/canais">Canais e conexões</Link><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Modelos por evento e canal</h2><p>Cobranças e avisos são enviados apenas por WhatsApp (Meta Cloud API). O e-mail (Resend) é usado somente para convites de equipe e autenticação. Os placeholders são preenchidos no momento do envio.</p></div></header><TemplateManager canManage={canManage} organizationId={organization.id} templates={templates ?? []} /></article>
  </section></>;
}
