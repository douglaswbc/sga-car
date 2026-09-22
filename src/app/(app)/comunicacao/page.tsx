import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageCommunication, canManageTemplates } from "@/features/auth/permissions";
import { MessageActions } from "@/features/messaging/message-actions";
import { ProcessQueue } from "@/features/messaging/process-queue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const statusLabels = { pending: "Pendente", processing: "Processando", sent: "Enviada", failed: "Falha", cancelled: "Cancelada" } as const;
const channelLabels = { email: "E-mail", whatsapp: "WhatsApp" } as const;
const eventLabels = { member_invite: "Convite", invoice_created: "Cobrança gerada", payment_receipt: "Recibo", invoice_due_soon: "Vencimento próximo", invoice_overdue: "Vencida" } as const;
const statusTones = { pending: "warning", processing: "neutral", sent: "success", failed: "danger", cancelled: "neutral" } as const;
const channelOptions = ["", "email", "whatsapp"] as const;
const statusOptions = ["", "pending", "processing", "sent", "failed", "cancelled"] as const;

type Props = { searchParams: Promise<{ status?: string; channel?: string; notice?: string; error?: string }> };

export default async function CommunicationsPage({ searchParams }: Readonly<Props>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const organization = organizations?.find((item) => item.status === "active");
  if (!organization) redirect("/");
  const canManage = canManageCommunication(organization.role);
  if (!canManage) redirect("/");
  const manager = canManageTemplates(organization.role);
  const { data: messages } = await supabase.rpc("list_messages", { target_organization_id: organization.id, filter_status: null, filter_channel: null });
  const records = messages ?? [];
  const status = (statusOptions as readonly string[]).includes(params.status ?? "") ? params.status ?? "" : "";
  const channel = (channelOptions as readonly string[]).includes(params.channel ?? "") ? params.channel ?? "" : "";
  const filtered = records.filter((message) => (!status || message.status === status) && (!channel || message.channel === channel));
  const counts = { pending: records.filter((item) => item.status === "pending").length, sent: records.filter((item) => item.status === "sent").length, failed: records.filter((item) => item.status === "failed").length };

  return <><header className="admin-header"><div><p className="eyebrow">Gestão</p><h1>Comunicação — {organization.name}</h1></div><div className="topbar-actions">{manager ? <Link className="button button--secondary" href="/comunicacao/canais">Canais e conexões</Link> : null}{canManage ? <ProcessQueue organizationId={organization.id} /> : null}<Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    {params.error ? <p className="form-message form-message--error" role="alert">{params.error}</p> : null}
    {params.notice ? <p className="form-message form-message--notice" role="status">{params.notice}</p> : null}
    <section className="metrics finance-metrics"><article className="metric-card"><p>Na fila</p><strong>{counts.pending}</strong><div>mensagem(ns) aguardando envio</div></article><article className="metric-card"><p>Enviadas</p><strong>{counts.sent}</strong><div>com confirmação do provedor</div></article><article className="metric-card"><p>Falhas</p><strong>{counts.failed}</strong><div>mensagem(ns) para reenviar</div></article></section>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Fila e histórico</h2><p>Filtre por status e canal. Use “Reenviar” para reprocessar uma mensagem.</p></div><form className="filter-form" method="get"><select defaultValue={status} name="status">{statusOptions.map((value) => <option key={value || "all"} value={value}>{value ? statusLabels[value as keyof typeof statusLabels] : "Todos os status"}</option>)}</select><select defaultValue={channel} name="channel">{channelOptions.map((value) => <option key={value || "all"} value={value}>{value ? channelLabels[value as keyof typeof channelLabels] : "Todos os canais"}</option>)}</select><button className="button button--secondary" type="submit">Filtrar</button></form></header>{filtered.length ? <div className="table-wrap"><table><thead><tr><th>Data</th><th>Locatário</th><th>Canal</th><th>Evento</th><th>Destinatário</th><th>Status</th><th>Tentativas</th>{canManage ? <th><span className="sr-only">Ação</span></th> : null}</tr></thead><tbody>{filtered.map((message) => <tr key={message.id}><td>{new Date(message.created_at).toLocaleString("pt-BR")}</td><td>{message.tenant_name ?? "—"}</td><td>{channelLabels[message.channel]}</td><td>{eventLabels[message.event]}{message.last_error ? <small className="table-subtitle">{message.last_error}</small> : null}</td><td>{message.recipient}</td><td><span className={`status status--${statusTones[message.status]}`}><span aria-hidden="true" />{statusLabels[message.status]}</span></td><td>{message.attempts}</td>{canManage ? <td><MessageActions messageId={message.id} organizationId={organization.id} /></td> : null}</tr>)}</tbody></table></div> : <p className="empty-state">Nenhuma mensagem registrada.</p>}</article>
  </section></>;
}
