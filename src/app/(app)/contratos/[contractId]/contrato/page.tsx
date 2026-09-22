import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageOperations } from "@/features/auth/permissions";
import { getSessionContext } from "@/features/auth/session";
import { ContractSignatureForm } from "@/features/contracts/contract-signature-form";
import { PrintButton } from "@/features/contracts/print-button";
import { formatPlate } from "@/features/fleet/vehicle-schema";
import { formatDocument, formatPhone } from "@/features/tenants/registration-schema";

type Props = { params: Promise<{ contractId: string }> };

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const billingLabels: Record<string, string> = { daily: "Diária", weekly: "Semanal", fortnightly: "Quinzenal", monthly: "Mensal", custom: "Personalizada" };

export default async function ContractDocumentPage({ params }: Readonly<Props>) {
  const { contractId } = await params;
  const { supabase, user, organization } = await getSessionContext();
  if (!user) redirect("/login");
  if (!organization || !canManageOperations(organization.role)) redirect("/contratos");

  const { data: contracts } = await supabase.rpc("list_rental_contracts", { target_organization_id: organization.id });
  const contract = contracts?.find((item) => item.id === contractId);
  if (!contract) redirect("/contratos");

  const [{ data: tenants }, { data: addresses }, { data: signatures }] = await Promise.all([
    supabase.rpc("list_tenants", { target_organization_id: organization.id }),
    supabase.rpc("get_tenant_address", { target_organization_id: organization.id, target_tenant_id: contract.tenant_id }),
    supabase.rpc("list_contract_signatures", { target_organization_id: organization.id, target_contract_id: contractId }),
  ]);
  const tenant = tenants?.find((item) => item.id === contract.tenant_id);
  const address = addresses?.[0];
  const signatureByRole = new Map((signatures ?? []).map((signature) => [signature.signer_role, signature]));

  return <><header className="admin-header"><div><p className="eyebrow">Contrato</p><h1>Contrato de locação</h1></div><div className="topbar-actions no-print"><Link className="button button--secondary" href="/contratos">Voltar</Link></div></header><section className="admin-content">
    <article className="panel" id="contrato">
      <div className="contract-document">
        <h2>Contrato de Locação de Veículo</h2>
        <p><strong>Locadora:</strong> {organization.name}</p>
        <p><strong>Locatário:</strong> {tenant?.full_name ?? contract.tenant_name}{tenant?.document_number ? ` · ${formatDocument(tenant.document_number)}` : ""}{tenant?.phone ? ` · ${formatPhone(tenant.phone)}` : ""}{tenant?.email ? ` · ${tenant.email}` : ""}</p>
        {address ? <p><strong>Endereço:</strong> {address.street}, {address.number}{address.complement ? `, ${address.complement}` : ""} — {address.neighborhood}, {address.city}/{address.state} · CEP {address.postal_code}</p> : null}
        <p><strong>Veículo:</strong> {contract.vehicle_brand} {contract.vehicle_model} · placa {formatPlate(contract.vehicle_plate)}</p>
        <p><strong>Período:</strong> {date(contract.starts_on)} a {date(contract.expected_return_on)}</p>
        <p><strong>Valor da diária:</strong> {money(Number(contract.daily_rate))} · <strong>Recorrência:</strong> {billingLabels[contract.billing_frequency] ?? contract.billing_frequency}</p>
        <p><strong>Caução:</strong> {money(Number(contract.security_deposit_amount ?? 0))}</p>
        <h3>Cláusulas</h3>
        <p>1. O locatário declara ter recebido o veículo em perfeito estado de conservação e funcionamento, comprometendo-se a devolvê-lo nas mesmas condições na data prevista.</p>
        <p>2. O valor da diária e a recorrência de cobrança estão descritos acima; atrasos na devolução sujeitam o locatário à cobrança de diária excedente e eventuais encargos.</p>
        <p>3. Avarias, multas e despesas de manutenção decorrentes do uso indevido são de responsabilidade do locatário, podendo ser descontadas da caução.</p>
        <p>4. A caução será devolvida após a vistoria de devolução, descontados eventuais débitos, sendo retida integralmente em caso de inadimplência não regularizada.</p>
        <div className="contract-signatures">
          <div><span>{signatureByRole.get("tenant") ? `${signatureByRole.get("tenant")?.signer_name} · assinado em ${new Date(signatureByRole.get("tenant")!.signed_at).toLocaleDateString("pt-BR")}` : "Aguardando assinatura do locatário"}</span><small>{tenant?.full_name ?? "Locatário"}</small></div>
          <div><span>{signatureByRole.get("company") ? `${signatureByRole.get("company")?.signer_name} · assinado em ${new Date(signatureByRole.get("company")!.signed_at).toLocaleDateString("pt-BR")}` : "Aguardando assinatura da locadora"}</span><small>{organization.name}</small></div>
        </div>
      </div>
    </article>
    <div className="connection-actions no-print">
      <PrintButton />
    </div>
    <ContractSignatureForm contractId={contractId} defaults={{ tenantName: tenant?.full_name ?? contract.tenant_name, tenantDocument: tenant?.document_number ?? "", companyName: organization.name }} organizationId={organization.id} />
  </section></>;
}
