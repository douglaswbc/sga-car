type MetaTemplate = { id: string; name: string; status: string; rejected_reason?: string };
type LocalTemplate = { id: string; name: string; body: string; status: string; category: "UTILITY" | "MARKETING" | "AUTHENTICATION"; language: string; body_examples: string[] };
type MetaConnection = { accessToken: string; businessAccountId: string };

function config(connection: MetaConnection) {
  if (!connection.accessToken || !connection.businessAccountId) throw new Error("Conexão Meta da organização incompleta.");
  return { token: connection.accessToken, wabaId: connection.businessAccountId, version: process.env.META_WHATSAPP_GRAPH_VERSION ?? "v21.0" };
}
async function request(connection: MetaConnection, path: string, init?: RequestInit) {
  const { token, version } = config(connection);
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
  const data: { error?: { message?: string }; data?: MetaTemplate[] } = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "Falha na API da Meta.");
  return data;
}
export async function pullMetaWhatsAppTemplates(connection: MetaConnection) {
  const { wabaId } = config(connection);
  const result = await request(connection, `${wabaId}/message_templates?fields=id,name,status,rejected_reason&limit=250`);
  return result.data ?? [];
}
export async function pushMetaWhatsAppTemplate(connection: MetaConnection, template: LocalTemplate) {
  const { wabaId } = config(connection);
  const body = template.body_examples.length ? { type: "BODY", text: template.body, example: { body_text: [template.body_examples] } } : { type: "BODY", text: template.body };
  return request(connection, `${wabaId}/message_templates`, { method: "POST", body: JSON.stringify({ name: template.name, language: template.language, category: template.category, components: [body] }) });
}
