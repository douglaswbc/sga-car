export const API_SCOPES = ["messaging:send", "messaging:read", "invoices:read", "tenants:read", "contracts:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "messaging:send": "Disparar envio de mensagens",
  "messaging:read": "Consultar fila e histórico de comunicações",
  "invoices:read": "Ler faturas e pagamentos",
  "tenants:read": "Ler locatários",
  "contracts:read": "Ler contratos",
};
