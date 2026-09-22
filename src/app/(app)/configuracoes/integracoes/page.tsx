import Link from "next/link";
import { redirect } from "next/navigation";
import { isManager } from "@/features/auth/permissions";
import { getSessionContext } from "@/features/auth/session";
import { ApiTokenManager } from "@/features/organizations/api-token-manager";

export default async function IntegrationsPage() {
  const { supabase, user, organization } = await getSessionContext();
  if (!user) redirect("/login");
  if (!organization || !isManager(organization.role)) redirect("/");

  const { data: tokens } = await supabase.rpc("list_organization_api_tokens", { target_organization_id: organization.id });

  return <><header className="admin-header"><div><p className="eyebrow">Configurações</p><h1>Integrações — {organization.name}</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/comunicacao/canais">Canais e conexões</Link><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    <article className="panel admin-panel"><header className="panel-header"><div><h2>API para integrações externas</h2><p>Os tokens autenticam o n8n no SGA. As credenciais de e-mail e WhatsApp permanecem apenas no servidor.</p></div></header><div className="connection-body"><p className="field-hint">Endpoints disponíveis conforme os escopos: <code>POST /api/integrations/messaging/dispatch</code> (messaging:send) e consultas de mensagens, faturas, locatários e contratos. Detalhes em <code>docs/n8n-messaging.md</code>.</p></div></article>
    <ApiTokenManager organizationId={organization.id} tokens={tokens ?? []} />
  </section></>;
}
