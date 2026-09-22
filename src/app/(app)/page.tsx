import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { saveDashboardReport } from "@/features/dashboard/actions";
import { DashboardControls } from "@/features/dashboard/dashboard-controls";
import { canManageFinance, canManageOperations, isManager, ROLE_LABELS, type OrganizationRole } from "@/features/auth/permissions";
import { getSessionContext } from "@/features/auth/session";
import type { DashboardReport, Invoice, RentalContract, Vehicle } from "@/lib/supabase/types";

type Tone = "success" | "warning" | "danger" | "neutral";
type Props = { searchParams: Promise<{ starts_on?: string; ends_on?: string }> };
type Maintenance = { id: string; title: string; scheduled_on: string; status: "scheduled" | "in_progress" | "completed" | "cancelled"; vehicle: Vehicle };
type DashboardData = { fleet: Vehicle[]; contracts: RentalContract[]; maintenance: Maintenance[]; invoices: Invoice[]; received: number; reports: DashboardReport[] };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
function Status({ tone, children }: Readonly<{ tone: Tone; children: React.ReactNode }>) { return <span className={`status status--${tone}`}><span />{children}</span>; }

export default async function Home({ searchParams }: Readonly<Props>) {
  const [params, session] = await Promise.all([searchParams, getSessionContext()]);
  const { user, isMaster, organization } = session;
  if (!user) redirect("/login");
  if (!isMaster && !organization) redirect(session.organizations.some((item) => item.status === "suspended") ? "/acesso-suspenso" : "/onboarding");
  if (!organization) redirect("/master");
  const role = organization.role;
  const financial = canManageFinance(role);
  const operations = canManageOperations(role);
  const manager = isManager(role);

  const now = new Date(); const defaultStart = isoDay(new Date(now.getFullYear(), now.getMonth(), 1)); const defaultEnd = isoDay(now);
  const startsOn = params.starts_on && /^\d{4}-\d{2}-\d{2}$/.test(params.starts_on) ? params.starts_on : defaultStart;
  const endsOn = params.ends_on && /^\d{4}-\d{2}-\d{2}$/.test(params.ends_on) && params.ends_on >= startsOn ? params.ends_on : defaultEnd;
  const dashboard = await getDashboard(session.supabase, organization.id, startsOn, endsOn, {
    fleet: operations,
    invoices: financial || role === "support",
    received: financial,
    reports: manager,
  });

  const primaryAction = operations
    ? { href: "/contratos", label: "Novo contrato" }
    : financial
      ? { href: "/financeiro", label: "Ver financeiro" }
      : { href: "/contratos", label: "Ver contratos" };

  return <>
    <header className="topbar"><div><p className="eyebrow">Operação</p><h1>Visão geral — {organization.name}</h1></div><div className="topbar-actions"><Link className="button" href={primaryAction.href}>{primaryAction.label}</Link></div></header>
    <div className="content"><Dashboard data={dashboard} endsOn={endsOn} organizationId={organization.id} role={role} startsOn={startsOn} /></div>
  </>;
}

type LoadFlags = { fleet: boolean; invoices: boolean; received: boolean; reports: boolean };

async function getDashboard(supabase: Awaited<ReturnType<typeof getSessionContext>>["supabase"], organizationId: string, startsOn: string, endsOn: string, flags: LoadFlags): Promise<DashboardData> {
  const [{ data: contracts }, { data: invoices }, { data: fleet }, { data: received }, { data: reports }] = await Promise.all([
    supabase.rpc("list_rental_contracts", { target_organization_id: organizationId }),
    flags.invoices ? supabase.rpc("list_invoices", { target_organization_id: organizationId }) : Promise.resolve({ data: [] as Invoice[] }),
    flags.fleet ? supabase.rpc("list_vehicles", { target_organization_id: organizationId }) : Promise.resolve({ data: [] as Vehicle[] }),
    flags.received ? supabase.rpc("dashboard_received_amount", { target_organization_id: organizationId, period_starts_on: startsOn, period_ends_on: endsOn }) : Promise.resolve({ data: 0 }),
    flags.reports ? supabase.rpc("list_dashboard_reports", { target_organization_id: organizationId }) : Promise.resolve({ data: [] as DashboardReport[] }),
  ]);
  const vehicles = fleet ?? [];
  const maintenance = flags.fleet
    ? (await Promise.all(vehicles.map(async (vehicle) => { const { data } = await supabase.rpc("list_vehicle_maintenance", { target_organization_id: organizationId, target_vehicle_id: vehicle.id }); return (data ?? []).filter((item) => item.status === "scheduled" || item.status === "in_progress").map((item) => ({ id: item.id, title: item.title, scheduled_on: item.scheduled_on, status: item.status, vehicle })); }))).flat()
    : [];
  return { invoices: invoices ?? [], fleet: vehicles, contracts: contracts ?? [], maintenance, received: Number(received ?? 0), reports: reports ?? [] };
}

function Dashboard({ data, startsOn, endsOn, organizationId, role }: Readonly<{ data: DashboardData; startsOn: string; endsOn: string; organizationId: string; role: OrganizationRole }>) {
  const financial = canManageFinance(role);
  const operations = canManageOperations(role);
  const manager = isManager(role);
  const open = data.invoices.filter((item) => item.status === "pending" || item.status === "overdue"); const overdue = data.invoices.filter((item) => item.status === "overdue");
  const receivable = open.reduce((sum, item) => sum + Number(item.amount_due) - Number(item.amount_paid), 0); const overdueAmount = overdue.reduce((sum, item) => sum + Number(item.amount_due) - Number(item.amount_paid), 0);
  const available = data.fleet.filter((item) => item.status === "available").length; const rented = data.fleet.filter((item) => item.status === "rented").length; const maintenanceCount = data.fleet.filter((item) => item.status === "maintenance").length; const inactive = data.fleet.filter((item) => item.status === "inactive").length;
  const nowDate = new Date(); const today = isoDay(nowDate); const soon = isoDay(new Date(nowDate.getTime() + 7 * 86400000)); const activeContracts = data.contracts.filter((item) => item.status === "active"); const returns = activeContracts.filter((item) => item.expected_return_on >= today && item.expected_return_on <= soon); const expired = activeContracts.filter((item) => item.expected_return_on < today); const maintenanceAlerts = data.maintenance.filter((item) => item.scheduled_on <= soon);
  const attention = open.filter((item) => item.due_on <= endsOn).slice(0, 8); const vehicleByContract = new Map(data.contracts.map((item) => [item.id, `${item.vehicle_brand} ${item.vehicle_model} · ${item.vehicle_plate}`]));
  const exportRows = attention.map((item) => ({ tenant: item.tenant_name, vehicle: item.contract_id ? vehicleByContract.get(item.contract_id) ?? "—" : "Cobrança avulsa", due: date(item.due_on), amount: money(Number(item.amount_due) - Number(item.amount_paid)), status: item.status === "overdue" ? "Vencida" : "Pendente" }));

  return <>
    {financial ? <DashboardControls endsOn={endsOn} rows={exportRows} startsOn={startsOn} /> : null}
    <section className="metrics" aria-label="Indicadores">
      {financial ? <>
        <Metric detail={`De ${date(startsOn)} até ${date(endsOn)}`} label="Recebido" tone="success" value={money(data.received)} />
        <Metric detail={`${open.length} fatura(s) em aberto`} label="A receber" tone="neutral" value={money(receivable)} />
        <Metric detail={`${overdue.length} fatura(s) vencida(s)`} label="Em atraso" tone="danger" value={money(overdueAmount)} />
        <Metric detail={operations ? `${data.fleet.length} veículo(s) na frota` : "Vínculos em andamento"} label={operations ? "Frota disponível" : "Contratos ativos"} tone="warning" value={operations ? `${available} veículo(s)` : `${activeContracts.length}`} />
      </> : operations ? <>
        <Metric detail={`${rented} alugado(s) de ${data.fleet.length}`} label="Frota disponível" tone="success" value={`${available} veículo(s)`} />
        <Metric detail={`${activeContracts.length} contrato(s) ativo(s)`} label="Alugados" tone="neutral" value={`${rented} veículo(s)`} />
        <Metric detail={`${maintenanceAlerts.length} alerta(s) de revisão`} label="Em manutenção" tone="warning" value={`${maintenanceCount} veículo(s)`} />
        <Metric detail="Fora de operação" label="Parados / inativos" tone="danger" value={`${inactive} veículo(s)`} />
      </> : <>
        <Metric detail={`${returns.length} nos próximos 7 dias`} label="Contratos ativos" tone="success" value={`${activeContracts.length}`} />
        <Metric detail="Até 7 dias" label="Devoluções próximas" tone="warning" value={`${returns.length}`} />
        <Metric detail="Prazo vencido" label="Contratos vencidos" tone="danger" value={`${expired.length}`} />
        <Metric detail={`${overdue.length} fatura(s) vencida(s)`} label="Pendências financeiras" tone="neutral" value={`${open.length}`} />
      </>}
    </section>
    <section className="dashboard-grid">
      {financial ? <article className="panel panel--wide"><header className="panel-header"><div><h2>Cobranças que precisam de ação</h2><p>Faturas pendentes e vencidas até o fim do período.</p></div><Link href="/financeiro">Ver todas</Link></header>{attention.length ? <div className="table-wrap"><table><thead><tr><th>Locatário</th><th>Veículo</th><th>Vencimento</th><th>Saldo</th><th>Status</th></tr></thead><tbody>{exportRows.map((item) => <tr key={`${item.tenant}-${item.due}`}><td><strong>{item.tenant}</strong></td><td>{item.vehicle}</td><td>{item.due}</td><td><strong>{item.amount}</strong></td><td><Status tone={item.status === "Vencida" ? "danger" : "warning"}>{item.status}</Status></td></tr>)}</tbody></table></div> : <p className="empty-state">Não há cobranças que exijam ação no período.</p>}</article> : null}
      {operations ? <article className="panel"><header className="panel-header"><div><h2>Status da frota</h2><p>Indicadores atuais da operação.</p></div></header><dl className="fleet-list"><div><dt><Status tone="success">Disponíveis</Status></dt><dd>{available}</dd></div><div><dt><Status tone="neutral">Alugados</Status></dt><dd>{rented}</dd></div><div><dt><Status tone="warning">Manutenção</Status></dt><dd>{maintenanceCount}</dd></div><div><dt><Status tone="danger">Parados / inativos</Status></dt><dd>{inactive}</dd></div></dl><Link className="panel-link" href="/frota">Ver frota completa</Link></article> : null}
    </section>
    <section className="dashboard-grid">
      <article className="panel"><header className="panel-header"><div><h2>Devoluções e contratos</h2><p>Contratos ativos com retorno nos próximos 7 dias ou já vencidos.</p></div><Link href="/contratos">Ver todos</Link></header>{returns.length || expired.length ? <div className="alert-list">{returns.map((item) => <p key={`r-${item.id}`}><Status tone="warning">{date(item.expected_return_on)}</Status> {item.tenant_name} · {item.vehicle_brand} {item.vehicle_model}</p>)}{expired.map((item) => <p key={`e-${item.id}`}><Status tone="danger">Vencido</Status> {item.tenant_name} · {item.vehicle_brand} {item.vehicle_model} — previsto para {date(item.expected_return_on)}</p>)}</div> : <p className="empty-state">Nenhuma devolução pendente ou contrato vencido.</p>}</article>
      {operations ? <article className="panel"><header className="panel-header"><div><h2>Manutenção programada</h2><p>Revisões previstas para os próximos 7 dias.</p></div><Link href="/frota">Ver frota</Link></header>{maintenanceAlerts.length ? <div className="alert-list">{maintenanceAlerts.slice(0, 8).map((item) => <p key={item.id}><Status tone="warning">{date(item.scheduled_on)}</Status> {item.title} · {item.vehicle.brand} {item.vehicle.model} ({item.vehicle.plate})</p>)}</div> : <p className="empty-state">Nenhuma manutenção programada para o período.</p>}</article> : null}
      {!operations && !financial ? <article className="panel"><header className="panel-header"><div><h2>Resumo do papel</h2><p>Você acessa o sistema como {ROLE_LABELS[role]}.</p></div></header><div className="alert-list"><p><Status tone="neutral">Operação</Status> Consulta de locatários, contratos, devoluções e comunicações.</p><p><Status tone="warning">Restrito</Status> Valores financeiros e configurações exigem outro papel.</p></div></article> : null}
    </section>
    {manager ? <section className="dashboard-grid"><article className="panel"><header className="panel-header"><div><h2>Relatórios salvos</h2><p>Períodos salvos pela equipe.</p></div></header>{data.reports.length ? <div className="saved-reports">{data.reports.map((report) => <Link href={`/?starts_on=${report.starts_on}&ends_on=${report.ends_on}`} key={report.id}>{report.name}<small>{date(report.starts_on)} — {date(report.ends_on)}</small></Link>)}</div> : <p className="empty-state">Nenhum relatório salvo ainda.</p>}<form action={saveDashboardReport.bind(null, organizationId)} className="save-report-form"><input name="starts_on" type="hidden" value={startsOn} /><input name="ends_on" type="hidden" value={endsOn} /><input aria-label="Nome do relatório" name="name" placeholder="Salvar período como…" required /><SubmitButton className="button button--secondary" pendingLabel="Salvando…">Salvar</SubmitButton></form></article></section> : null}
  </>;
}

function Metric({ label, value, detail, tone }: Readonly<{ label: string; value: string; detail: string; tone: Tone }>) { return <article className="metric-card"><p>{label}</p><strong>{value}</strong><div><Status tone={tone}>{detail}</Status></div></article>; }
