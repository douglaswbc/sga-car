import { query } from "@/lib/db";
import { decryptConnectionSecret } from "@/lib/messaging/connection-crypto";

type SendWhatsAppInput = { organizationId: string; to: string; body: string; templateName: string | null; templateLanguage: string | null; parameters: string[] };
type WhatsappConnection = { phone_number_id: string; access_token_ciphertext: string };

export async function sendWhatsApp({ organizationId, to, body, templateName, templateLanguage, parameters }: SendWhatsAppInput): Promise<{ id?: string }> {
  const connections = await query<WhatsappConnection>("select phone_number_id, access_token_ciphertext from public.organization_whatsapp_connections where organization_id = $1", [organizationId]);
  const connection = connections[0];
  if (!connection) throw new Error("WhatsApp não está configurado para esta organização.");
  const accessToken = decryptConnectionSecret(connection.access_token_ciphertext);
  const phoneNumberId = connection.phone_number_id;
  const graphVersion = process.env.META_WHATSAPP_GRAPH_VERSION ?? "v21.0";
  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: templateName, language: { code: templateLanguage ?? "pt_BR" }, components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: { messages?: { id: string }[]; error?: { message?: string } } | null = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message ?? "Falha ao enviar WhatsApp.");
  return { id: data?.messages?.[0]?.id };
}
