import type { MessageEvent } from "@/lib/supabase/types";

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (key === "amount" || key.endsWith("_amount")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : String(value);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00`).toLocaleDateString("pt-BR");
  return text;
}

export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => formatValue(key, payload[key]));
}

export const whatsappEventParameters: Record<MessageEvent, string[]> = {
  member_invite: ["member_name", "organization_name"],
  invoice_created: ["tenant_name", "amount", "due_on"],
  payment_receipt: ["tenant_name", "amount", "paid_on"],
  invoice_due_soon: ["tenant_name", "amount", "due_on"],
  invoice_overdue: ["tenant_name", "amount", "due_on"],
};

export function templateParameters(payload: Record<string, unknown>, keys: string[]): string[] {
  return keys.map((key) => formatValue(key, payload[key]));
}
