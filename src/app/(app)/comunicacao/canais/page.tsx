import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageTemplates } from "@/features/auth/permissions";
import { ConnectionTests } from "@/features/messaging/connection-tests";
import { ZernioConnection } from "@/features/messaging/zernio-connection";
import { WhatsappDeliverySettings } from "@/features/messaging/whatsapp-delivery-settings";
import { ZERNIO_WEBHOOK_EVENTS } from "@/features/zernio/server";
import { getMessagingConfigStatus } from "@/lib/messaging/diagnostics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ notice?: string; error?: string }> };

export default async function CommunicationChannelsPage({ searchParams }: Readonly<Props>) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: isMaster }, { data: organizations }] = await Promise.all([
    supabase.rpc("is_platform_administrator"),
    supabase.rpc("get_my_organizations"),
  ]);
  const organization = organizations?.find((item) => item.status === "active");
  if (!organization && !isMaster) redirect("/");
  const canManage = organization ? canManageTemplates(organization.role) : false;
  const connectionStatus = organization && canManage
    ? (await Promise.all([
      supabase.rpc("ensure_organization_zernio_whatsapp_templates", { target_organization_id: organization.id }),
      supabase.rpc("get_organization_zernio_connection_status", { target_organization_id: organization.id }),
    ]))[1].data?.[0] ?? null
    : null;  const deliveryRows = organization && canManage
    ? (await supabase.rpc("get_organization_messaging_settings", { target_organization_id: organization.id })).data
    : null;
  const whatsappDelivery = deliveryRows?.[0]?.whatsapp_delivery ?? "sga";
  const webhookRows = organization && canManage
    ? (await supabase.rpc("get_organization_zernio_webhook_status", { target_organization_id: organization.id })).data
    : null;
  const webhookRow = webhookRows?.[0] ?? null;
  const config = getMessagingConfigStatus();

  return <><header className="admin-header"><div><p className="eyebrow">Comunicação</p><h1>Canais e conexões{organization ? ` — ${organization.name}` : " da plataforma"}</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/comunicacao">Fila de envio</Link><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    {params.error ? <p className="form-message form-message--error" role="alert">{params.error}</p> : null}
    {params.notice ? <p className="form-message form-message--notice" role="status">{params.notice}</p> : null}
    {isMaster ? <ConnectionTests config={config} /> : null}
    {organization && canManage ? <WhatsappDeliverySettings current={whatsappDelivery} organizationId={organization.id} /> : null}
    {organization && canManage ? (
      <ZernioConnection
        connection={connectionStatus}
        organizationId={organization.id}
        webhook={connectionStatus ? { registered: Boolean(webhookRow?.webhook_id), registeredAt: webhookRow?.registered_at ?? null, events: webhookRow?.webhook_events ?? [], supportedEvents: ZERNIO_WEBHOOK_EVENTS, url: `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/api/webhooks/zernio/${encodeURIComponent(connectionStatus.account_id)}` } : null}
      />
    ) : null}
  </section></>;
}
