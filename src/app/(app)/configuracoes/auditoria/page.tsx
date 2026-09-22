import Link from "next/link";
import { redirect } from "next/navigation";
import { isManager } from "@/features/auth/permissions";
import { getSessionContext } from "@/features/auth/session";

const actionLabels: Record<string, string> = {
  "organization.requested": "Solicitação de organização",
  "organization.approved": "Organização aprovada",
  "organization.suspended": "Organização suspensa",
  "organization.reactivated": "Organização reativada",
  "member.invited": "Convite enviado",
  "member.invite_revoked": "Convite revogado",
  "member.invite_accepted": "Convite aceito",
  "member.role_updated": "Papel atualizado",
  "member.removed": "Membro removido",
  "contract.created": "Contrato criado",
  "contract.updated": "Contrato atualizado",
  "contract.deleted": "Contrato excluído",
  "contract.settled": "Contrato encerrado",
  "contract.renewed": "Contrato prorrogado",
  "contract.deposit_set": "Caução definida",
  "contract.deposit_charged": "Caução cobrada",
  "contract.deposit_settled": "Caução encerrada",
  "contract.fee_added": "Taxa adicionada",
  "contract.fee_removed": "Taxa removida",
  "invoice.generated": "Faturas geradas",
  "invoice.created": "Cobrança criada",
  "invoice.adjusted": "Fatura ajustada",
  "invoice.renegotiated": "Fatura renegociada",
  "invoice.fee_added": "Taxa na fatura",
  "payment.recorded": "Pagamento registrado",
};

const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR");

export default async function AuditPage() {
  const { supabase, user, organization } = await getSessionContext();
  if (!user) redirect("/login");
  if (!organization || !isManager(organization.role)) redirect("/");

  const { data: logs } = await supabase.rpc("list_audit_logs", { target_organization_id: organization.id, filter_limit: 200 });
  const records = logs ?? [];

  return <><header className="admin-header"><div><p className="eyebrow">Configurações</p><h1>Auditoria — {organization.name}</h1></div><div className="topbar-actions"><Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Registro de ações</h2><p>{records.length} evento(s) recente(s). Os registros são imutáveis.</p></div></header>{records.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Data</th><th scope="col">Ator</th><th scope="col">Ação</th><th scope="col">Resumo</th></tr></thead><tbody>{records.map((log) => <tr key={log.id}><td>{dateTime(log.created_at)}</td><td>{log.actor_email ?? "Sistema"}</td><td><strong>{actionLabels[log.action] ?? log.action}</strong><small className="table-subtitle">{log.entity_type}</small></td><td>{log.summary}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhuma ação registrada ainda.</p>}</article>
  </section></>;
}
