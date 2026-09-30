import { query } from "@/lib/db";
import { decryptConnectionSecret } from "@/lib/messaging/connection-crypto";
import { createConversation, toE164, ZernioApiError } from "@/features/zernio/api-client";

type SendWhatsAppInput = { organizationId: string; to: string; body: string; templateName: string | null; templateLanguage: string | null; parameters: string[] };
type ZernioConnection = { account_id: string; api_key_ciphertext: string; display_name: string | null };

export type ZernioConnectionSummary = { accountId: string; displayName: string | null };

export async function readZernioConnection(organizationId: string): Promise<{ apiKey: string; accountId: string }> {
  const connections = await query<ZernioConnection>("select account_id, api_key_ciphertext, display_name from public.organization_zernio_connections where organization_id = $1", [organizationId]);
  const connection = connections[0];
  if (!connection) throw new Error("WhatsApp não está configurado para esta organização.");
  return { apiKey: decryptConnectionSecret(connection.api_key_ciphertext), accountId: connection.account_id };
}

/**
 * Envia pelo Zernio. A Meta só aceita texto livre dentro da janela de 24 horas de uma
 * conversa já aberta, e a API do Zernio exige um modelo aprovado para abrir a conversa.
 * Como a SGA não rastreia essa janela, todo envio usa o modelo resolvido pelo dispatch —
 * é o mesmo caminho que já funcionava na integração direta da Meta.
 */
export async function sendWhatsApp({ organizationId, to, body, templateName, templateLanguage, parameters }: SendWhatsAppInput): Promise<{ id?: string }> {
  const { apiKey, accountId } = await readZernioConnection(organizationId);
  if (!templateName) throw new Error("O WhatsApp exige um modelo aprovado para iniciar a conversa.");

  const recipient = toE164(to);
  if (!recipient) throw new Error("Número de WhatsApp inválido para esta organização.");

  const response = await createConversation(apiKey, {
    accountId,
    to: recipient,
    templateName,
    templateLanguage: templateLanguage ?? "pt_BR",
    templateParams: parameters,
    text: body,
  });

  const id = response.wamid ?? response.platformMessageId ?? response.messageId;
  if (!id) throw new ZernioApiError("O Zernio não devolveu o identificador da mensagem.", 502);
  return { id };
}
