import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageOperations } from "@/features/auth/permissions";
import { VehicleForm } from "@/features/fleet/vehicle-form";
import { VehicleActions } from "@/features/fleet/vehicle-actions";
import { formatPlate } from "@/features/fleet/vehicle-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type FleetPageProps = { searchParams: Promise<{ error?: string; notice?: string }> };
const vehicleStatus: Record<"available" | "rented" | "maintenance" | "inactive", string> = { available: "Disponível", rented: "Alugado", maintenance: "Manutenção", inactive: "Inativo" };

export default async function FleetPage({ searchParams }: Readonly<FleetPageProps>) {
  const [params, supabase] = await Promise.all([searchParams, createSupabaseServerClient()]); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");
  const { data: organizations } = await supabase.rpc("get_my_organizations"); const organization = organizations?.find((item) => item.status === "active"); if (!organization) redirect("/");
  const canManage = canManageOperations(organization.role); if (!canManage) redirect("/");
  const { data: vehicles } = await supabase.rpc("list_vehicles", { target_organization_id: organization.id });
  return <><header className="admin-header"><div><p className="eyebrow">Operação</p><h1>Frota — {organization.name}</h1></div><div className="topbar-actions">{canManage ? <VehicleForm organizationId={organization.id} /> : null}<Link className="button button--secondary" href="/">Voltar ao sistema</Link></div></header><section className="admin-content">{params.error ? <p className="form-message form-message--error" role="alert">{params.error}</p> : null}{params.notice ? <p className="form-message form-message--notice" role="status">{params.notice}</p> : null}<article className="panel admin-panel"><header className="panel-header"><div><h2>Veículos cadastrados</h2><p>{vehicles?.length ?? 0} veículo(s) na frota.</p></div></header>{vehicles?.length ? <div className="table-wrap"><table><thead><tr><th>Veículo</th><th>Placa</th><th>Categoria</th><th>Quilometragem</th><th>Status</th>{canManage ? <th><span className="sr-only">Ação</span></th> : null}</tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.id}><td><strong>{vehicle.brand} {vehicle.model}</strong>{vehicle.model_year ? <small className="table-subtitle">{vehicle.model_year}{vehicle.color ? ` · ${vehicle.color}` : ""}</small> : null}</td><td>{formatPlate(vehicle.plate)}</td><td>{vehicle.category || "—"}</td><td>{vehicle.odometer_km.toLocaleString("pt-BR")} km</td><td><span className={`vehicle-status vehicle-status--${vehicle.status}`}>{vehicleStatus[vehicle.status]}</span></td>{canManage ? <td><VehicleActions organizationId={organization.id} vehicle={vehicle} /></td> : null}</tr>)}</tbody></table></div> : <p className="empty-state">Nenhum veículo cadastrado. Cadastre o primeiro veículo da frota.</p>}</article></section></>;
}
