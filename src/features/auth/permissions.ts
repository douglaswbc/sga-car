export type OrganizationRole = "owner" | "admin" | "finance" | "operations" | "support";

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  finance: "Financeiro",
  operations: "Operações",
  support: "Suporte",
};

const OPERATOR_ROLES: readonly OrganizationRole[] = ["owner", "admin", "operations"];
const FINANCE_ROLES: readonly OrganizationRole[] = ["owner", "admin", "finance"];
const COMMUNICATION_ROLES: readonly OrganizationRole[] = ["owner", "admin", "finance", "operations"];
const MANAGER_ROLES: readonly OrganizationRole[] = ["owner", "admin"];
const OWNER_ROLES: readonly OrganizationRole[] = ["owner"];

function includesRole(role: OrganizationRole | null | undefined, allowed: readonly OrganizationRole[]): boolean {
  return role !== null && role !== undefined && allowed.includes(role);
}

export const canManageOperations = (role: OrganizationRole | null | undefined) => includesRole(role, OPERATOR_ROLES);
export const canManageFinance = (role: OrganizationRole | null | undefined) => includesRole(role, FINANCE_ROLES);
export const canManageCommunication = (role: OrganizationRole | null | undefined) => includesRole(role, COMMUNICATION_ROLES);
export const canManageTemplates = (role: OrganizationRole | null | undefined) => includesRole(role, MANAGER_ROLES);
export const canManageTeam = (role: OrganizationRole | null | undefined) => includesRole(role, OWNER_ROLES);
export const isManager = (role: OrganizationRole | null | undefined) => includesRole(role, MANAGER_ROLES);

export type NavItem = { href: string; label: string };
export type NavSection = { label: string; items: NavItem[] };
export type Navigation = { primary: NavItem; sections: NavSection[] };

const TENANT_NAV: NavItem[] = [
  { href: "/locatarios", label: "Locatários" },
  { href: "/contratos", label: "Contratos" },
];
const FLEET_NAV: NavItem = { href: "/frota", label: "Frota e manutenção" };
const DASHBOARD_NAV: NavItem = { href: "/", label: "Visão geral" };
const PLATFORM_NAV: NavItem = { href: "/master", label: "Organizações" };
const CONNECTIONS_NAV: NavItem = { href: "/comunicacao/canais", label: "Comunicação e conexões" };
const TEMPLATES_NAV: NavItem = { href: "/comunicacao/templates", label: "Templates de mensagem" };

export function getNavigation(role: OrganizationRole | null, isMaster: boolean): Navigation {
  if (!role) {
    return isMaster
      ? { primary: PLATFORM_NAV, sections: [{ label: "Plataforma", items: [CONNECTIONS_NAV] }] }
      : { primary: DASHBOARD_NAV, sections: [] };
  }

  const sections: NavSection[] = [
    {
      label: "Operação",
      items: canManageOperations(role) ? [...TENANT_NAV, FLEET_NAV] : TENANT_NAV,
    },
  ];

  const management: NavItem[] = [];
  if (canManageFinance(role)) management.push({ href: "/financeiro", label: "Financeiro" });
  if (canManageCommunication(role)) management.push({ href: "/comunicacao", label: "Comunicação" });
  if (canManageTemplates(role)) management.push(TEMPLATES_NAV);
  if (canManageTemplates(role)) management.push({ href: "/comunicacao/canais", label: "Canais e conexões" });
  if (management.length) sections.push({ label: "Gestão", items: management });

  const settings: NavItem[] = [];
  if (canManageTeam(role)) settings.push({ href: "/configuracoes/equipe", label: "Equipe" });
  if (isManager(role)) settings.push({ href: "/configuracoes/auditoria", label: "Auditoria" });
  if (isManager(role)) settings.push({ href: "/configuracoes/integracoes", label: "Integrações" });
  if (settings.length) sections.push({ label: "Configurações", items: settings });

  if (isMaster) {
    const platformItems: NavItem[] = [PLATFORM_NAV];
    if (!canManageTemplates(role)) platformItems.push(CONNECTIONS_NAV);
    sections.push({ label: "Plataforma", items: platformItems });
  }

  return { primary: DASHBOARD_NAV, sections };
}
