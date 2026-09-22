import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageCommunication, canManageFinance, canManageOperations, isManager } from "@/features/auth/permissions";
import { TenantPreferences } from "@/features/messaging/tenant-preferences";
import { saveTenantAddress } from "@/features/tenants/actions";
import { TenantActions } from "@/features/tenants/tenant-actions";
import { TenantDocuments } from "@/features/tenants/tenant-documents";
import { TenantPrivacyActions } from "@/features/tenants/tenant-privacy-actions";
import { formatDocument, formatPhone } from "@/features/tenants/registration-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const contractStatus: Record<string, string> = { active: "Ativo", completed: "Concluído", cancelled: "Cancelado" };
const invoiceStatus: Record<string, string> = { pending: "Pendente", paid: "Paga", overdue: "Vencida", cancelled: "Cancelada", reversed: "Estornada" };
const paymentMethod: Record<string, string> = { cash: "Dinheiro", pix: "Pix", bank_transfer: "Transferência", credit_card: "Crédito", debit_card: "Débito", other: "Outro" };
const messageStatus: Record<string, string> = { pending: "Pendente", processing: "Processando", sent: "Enviada", failed: "Falha", cancelled: "Cancelada" };
const messageChannel: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp" };
const messageEvent: Record<string, string> = { member_invite: "Convite", invoice_created: "Cobrança", payment_receipt: "Recibo", invoice_due_soon: "Vencimento", invoice_overdue: "Vencida" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type TenantDetailPageProps = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ error?: string; notice?: string }> };

export default async function TenantDetailPage({ params, searchParams }: Readonly<TenantDetailPageProps>) {
  const [{ tenantId }, query, supabase] = await Promise.all([params, searchParams, createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const organization = organizations?.find((item) => item.status === "active");
  if (!organization) redirect("/");
  const canManage = canManageOperations(organization.role);
  const canSeeFinance = canManageFinance(organization.role);
  const canSeeCommunications = canManageCommunication(organization.role);
  const manager = isManager(organization.role);
  const [{ data: tenants }, { data: addresses }, { data: documents }, { data: contracts }, { data: invoices }, { data: payments }, { data: communications }, { data: preferenceRows }] = await Promise.all([
    supabase.rpc("list_tenants", { target_organization_id: organization.id }),
    canManage ? supabase.rpc("get_tenant_address", { target_organization_id: organization.id, target_tenant_id: tenantId }) : Promise.resolve({ data: null }),
    canManage ? supabase.rpc("list_tenant_documents", { target_organization_id: organization.id, target_tenant_id: tenantId }) : Promise.resolve({ data: null }),
    supabase.rpc("list_rental_contracts", { target_organization_id: organization.id }),
    canSeeFinance ? supabase.rpc("list_invoices", { target_organization_id: organization.id }) : Promise.resolve({ data: null }),
    canSeeFinance ? supabase.rpc("list_tenant_payments", { target_organization_id: organization.id, target_tenant_id: tenantId }) : Promise.resolve({ data: null }),
    canSeeCommunications ? supabase.rpc("list_tenant_communications", { target_organization_id: organization.id, target_tenant_id: tenantId }) : Promise.resolve({ data: null }),
    canManage ? supabase.rpc("get_tenant_preferences", { target_organization_id: organization.id, target_tenant_id: tenantId }) : Promise.resolve({ data: null }),
  ]);
  const tenant = tenants?.find((item) => item.id === tenantId);
  if (!tenant) redirect("/locatarios");
  const address = addresses?.[0];
  const preferences = preferenceRows?.[0] ?? { email_opt_in: true, whatsapp_opt_in: true, consent_at: null };
  const tenantContracts = contracts?.filter((contract) => contract.tenant_id === tenant.id) ?? [];
  const tenantInvoices = invoices?.filter((invoice) => invoice.tenant_id === tenant.id) ?? [];

  return <><header className="admin-header"><div><p className="eyebrow">Locatário</p><h1>{tenant.full_name}</h1><p className="header-status"><span className={tenant.status === "active" ? "status status--success" : "status status--neutral"}><span aria-hidden="true" />{tenant.status === "active" ? "Ativo" : "Inativo"}</span><span className={tenant.is_eligible ? "status status--success" : "status status--warning"}><span aria-hidden="true" />{tenant.is_eligible ? "Apto para locação" : "Elegibilidade pendente"}</span></p></div><div className="topbar-actions">{canManage ? <TenantActions organizationId={organization.id} tenant={tenant} /> : null}{manager ? <TenantPrivacyActions organizationId={organization.id} tenantId={tenant.id} tenantName={tenant.full_name} /> : null}<Link className="button button--secondary" href="/locatarios">Voltar aos locatários</Link></div></header><section className="admin-content">
    {query.error ? <p className="form-message form-message--error" role="alert">{query.error}</p> : null}
    {query.notice ? <p className="form-message form-message--notice" role="status">{query.notice}</p> : null}
    <article className="panel"><header className="panel-header"><div><h2>Cadastro</h2><p>Documento, contato e situação do locatário.</p></div></header><dl className="fleet-list"><div><dt>Documento</dt><dd>{tenant.document_number ? formatDocument(tenant.document_number) : "—"}</dd></div><div><dt>E-mail</dt><dd>{tenant.email ?? "—"}</dd></div><div><dt>Telefone</dt><dd>{tenant.phone ? formatPhone(tenant.phone) : "—"}</dd></div><div><dt>Cadastrado em</dt><dd>{new Date(tenant.created_at).toLocaleDateString("pt-BR")}</dd></div></dl></article>
    {canManage ? <article className="panel"><header className="panel-header"><div><h2>Endereço</h2><p>CEP, logradouro, número, bairro, cidade e UF são obrigatórios.</p></div></header><form action={saveTenantAddress} className="address-form"><input name="organizationId" type="hidden" value={organization.id} /><input name="tenantId" type="hidden" value={tenant.id} /><label htmlFor="postalCode">CEP</label><input defaultValue={address?.postal_code ?? ""} id="postalCode" inputMode="numeric" maxLength={9} name="postalCode" pattern="[0-9]{5}-?[0-9]{3}" placeholder="00000-000" required type="text" /><label htmlFor="street">Logradouro</label><input defaultValue={address?.street ?? ""} id="street" maxLength={160} minLength={3} name="street" required type="text" /><label htmlFor="number">Número</label><input defaultValue={address?.number ?? ""} id="number" maxLength={32} name="number" required type="text" /><label htmlFor="complement">Complemento</label><input defaultValue={address?.complement ?? ""} id="complement" maxLength={120} name="complement" type="text" /><label htmlFor="neighborhood">Bairro</label><input defaultValue={address?.neighborhood ?? ""} id="neighborhood" maxLength={120} minLength={2} name="neighborhood" required type="text" /><label htmlFor="city">Cidade</label><input defaultValue={address?.city ?? ""} id="city" maxLength={120} minLength={2} name="city" required type="text" /><label htmlFor="state">UF</label><select defaultValue={address?.state ?? ""} id="state" name="state" required><option disabled value="">Selecione</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}</select><button className="button" type="submit">Salvar endereço</button></form></article> : null}
    {canManage ? <TenantDocuments canManage={canManage} documents={documents ?? []} organizationId={organization.id} tenantId={tenant.id} /> : null}
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Histórico de contratos</h2><p>{tenantContracts.length} contrato(s).</p></div></header>{tenantContracts.length ? <div className="table-wrap"><table><thead><tr><th>Veículo</th><th>Período</th><th>Diária</th><th>Status</th></tr></thead><tbody>{tenantContracts.map((contract) => <tr key={contract.id}><td><strong>{contract.vehicle_brand} {contract.vehicle_model}</strong></td><td>{date(contract.starts_on)} — {date(contract.actual_return_on ?? contract.expected_return_on)}</td><td>{money(Number(contract.daily_rate))}</td><td>{contractStatus[contract.status] ?? contract.status}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhum contrato registrado.</p>}</article>
    {canSeeFinance ? <article className="panel admin-panel"><header className="panel-header"><div><h2>Histórico de cobranças</h2><p>{tenantInvoices.length} fatura(s).</p></div></header>{tenantInvoices.length ? <div className="table-wrap"><table><thead><tr><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Status</th></tr></thead><tbody>{tenantInvoices.map((invoice) => <tr key={invoice.id}><td>{date(invoice.due_on)}</td><td>{money(Number(invoice.amount_due))}</td><td>{money(Number(invoice.amount_paid))}</td><td>{money(Number(invoice.amount_due) - Number(invoice.amount_paid))}</td><td>{invoiceStatus[invoice.status] ?? invoice.status}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhuma cobrança registrada.</p>}</article> : null}
    {canSeeFinance ? <article className="panel admin-panel"><header className="panel-header"><div><h2>Histórico de pagamentos</h2><p>{payments?.length ?? 0} pagamento(s).</p></div></header>{payments?.length ? <div className="table-wrap"><table><thead><tr><th>Data</th><th>Valor</th><th>Método</th><th>Comprovante</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{date(payment.paid_on)}</td><td>{money(Number(payment.amount))}</td><td>{paymentMethod[payment.method] ?? payment.method}</td><td>{payment.receipt_url ? <a className="table-action" href={payment.receipt_url} rel="noreferrer" target="_blank">Ver</a> : "—"}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhum pagamento registrado.</p>}</article> : null}
    {canManage ? <article className="panel admin-panel"><header className="panel-header"><div><h2>Preferências de contato</h2><p>Opt-in de e-mail e WhatsApp e consentimento LGPD.</p></div></header><TenantPreferences canManage={canManage} organizationId={organization.id} preferences={preferences} tenantId={tenant.id} /></article> : null}
    {canSeeCommunications ? <article className="panel admin-panel"><header className="panel-header"><div><h2>Histórico de comunicações</h2><p>{communications?.length ?? 0} mensagem(ns).</p></div><Link href="/comunicacao">Ver fila completa</Link></header>{communications?.length ? <div className="table-wrap"><table><thead><tr><th>Data</th><th>Canal</th><th>Evento</th><th>Destinatário</th><th>Status</th></tr></thead><tbody>{communications.map((message) => <tr key={message.id}><td>{new Date(message.created_at).toLocaleString("pt-BR")}</td><td>{messageChannel[message.channel]}</td><td>{messageEvent[message.event]}{message.last_error ? <small className="table-subtitle">{message.last_error}</small> : null}</td><td>{message.recipient}</td><td>{messageStatus[message.status] ?? message.status}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhuma comunicação registrada.</p>}</article> : null}
  </section></>;
}
