import { randomBytes } from "node:crypto";
import { query } from "@/lib/db";
import { decryptConnectionSecret, encryptConnectionSecret } from "@/lib/messaging/connection-crypto";
import {
  createWebhookSettings,
  deleteWebhookSettings,
  getWhatsAppConnectUrl,
  listAccounts,
  updateWebhookSettings,
  ZernioApiError,
} from "@/features/zernio/api-client";

export type ZernioConnectionRow = {
  account_id: string;
  profile_id: string | null;
  api_key_ciphertext: string;
  display_name: string | null;
  webhook_id: string | null;
  webhook_secret_ciphertext: string | null;
  webhook_events: string[] | null;
  webhook_registered_at: Date | null;
};

export const ZERNIO_WEBHOOK_EVENTS = [
  "message.received",
  "message.delivered",
  "message.read",
  "message.failed",
  "whatsapp.template.status_updated",
  "account.disconnected",
] as const;

export const ZERNIO_WEBHOOK_EVENTS_TEXT = ZERNIO_WEBHOOK_EVENTS.join(", ");

export function publicSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
}

/** A URL carrega o accountId porque cada organização registra o seu endpoint com secret próprio. */
export function webhookUrlFor(accountId: string) {
  return `${publicSiteUrl()}/api/webhooks/zernio/${encodeURIComponent(accountId)}`;
}

export async function readZernioConnectionRow(organizationId: string) {
  const rows = await query<ZernioConnectionRow>(
    "select account_id, profile_id, api_key_ciphertext, display_name, webhook_id, webhook_secret_ciphertext, webhook_events, webhook_registered_at from public.organization_zernio_connections where organization_id = $1",
    [organizationId],
  );
  return rows[0] ?? null;
}

export async function requireZernioConnection(organizationId: string) {
  const row = await readZernioConnectionRow(organizationId);
  if (!row) throw new Error("WhatsApp não está configurado para esta organização.");
  return { row, apiKey: decryptConnectionSecret(row.api_key_ciphertext) };
}

/**
 * Abre o fluxo de conexão da Zernio.
 *
 * O nonce viaja dentro do `redirect_url` porque a Zernio preserva os query params da URL
 * de redirecionamento. Sem ele, o callback não teria como saber qual organização e qual
 * tentativa de conexão está concluindo.
 */
export async function startConnectFlow(organizationId: string, brandName?: string) {
  const row = await readZernioConnectionRow(organizationId);
  if (!row) throw new Error("Informe a API key do Zernio antes de conectar o número.");
  const apiKey = decryptConnectionSecret(row.api_key_ciphertext);

  const nonce = randomBytes(24).toString("base64url");
  const siteUrl = publicSiteUrl();
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL precisa estar configurada para o retorno da conexão.");

  const redirectUrl = new URL("/api/messaging/zernio/connect/callback", siteUrl);
  redirectUrl.searchParams.set("sga_state", nonce);

  await query("delete from public.zernio_connect_sessions where organization_id = $1 and expires_at < now()", [organizationId]);
  await query(
    "insert into public.zernio_connect_sessions (organization_id, nonce, profile_id, redirect_url) values ($1, $2, $3, $4)",
    [organizationId, nonce, row.profile_id, redirectUrl.toString()],
  );

  const response = await getWhatsAppConnectUrl(apiKey, {
    profileId: row.profile_id ?? undefined,
    redirectUrl: redirectUrl.toString(),
    brandName: brandName?.trim() || "SGA",
    language: "pt-BR",
  });
  if (!response.authUrl) throw new ZernioApiError("A Zernio não devolveu a URL de conexão.", 502);
  return response.authUrl;
}

/**
 * Resolve a sessão de conexão aberta pelo callback.
 *
 * O `accountId` chega na query string e, portanto, não é confiável: o nonce é o que
 * identifica a tentativa, e a organização é a do nonce — não a que veio no parâmetro.
 */
export async function consumeConnectSession(nonce: string) {
  const sessions = await query<{ id: string; organization_id: string; expires_at: Date; completed_at: Date | null }>(
    "select id, organization_id, expires_at, completed_at from public.zernio_connect_sessions where nonce = $1",
    [nonce],
  );
  const session = sessions[0];
  if (!session) throw new Error("Conexão não reconhecida. Inicie o processo novamente.");
  if (session.completed_at) throw new Error("Esta conexão já foi concluída.");
  if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("A conexão expirou. Inicie o processo novamente.");
  return session;
}

export type ConnectOutcome = { ok: true; accountId: string; displayName: string | null } | { ok: false; error: string; errorCode: string | null; userFixable: boolean };

/**
 * Persiste o número conectado. O `accountId` é conferido contra as contas de WhatsApp da
 * API key antes de gravar, para que um callback adulterado não aponte a organização para
 * uma conta de terceiro.
 */
export async function completeConnectFlow(session: { id: string; organization_id: string }, accountId: string): Promise<ConnectOutcome> {
  const { apiKey } = await requireZernioConnection(session.organization_id);
  const accounts = await listAccounts(apiKey);
  const account = accounts.accounts?.find((item) => item._id === accountId);
  if (!account) {
    await query("update public.zernio_connect_sessions set completed_at = now() where id = $1", [session.id]);
    return { ok: false, error: "A conta conectada não aparece entre as contas de WhatsApp desta API key.", errorCode: "account_not_found", userFixable: false };
  }

  const displayName = account.displayName ?? account.username ?? null;
  await query(
    `update public.organization_zernio_connections
       set account_id = $2, profile_id = $3, display_name = $4, updated_at = now()
     where organization_id = $1`,
    [session.organization_id, accountId, account.profileId?._id ?? null, displayName],
  );
  await query("update public.zernio_connect_sessions set completed_at = now() where id = $1", [session.id]);
  return { ok: true, accountId, displayName };
}

/**
 * Registra (ou re-registra) o webhook da organização. O secret é gerado aqui e guardado
 * cifrado; a Zernio assina cada entrega com ele.
 */
export async function registerWebhook(organizationId: string) {
  const { row, apiKey } = await requireZernioConnection(organizationId);
  const url = webhookUrlFor(row.account_id);
  if (!process.env.NEXT_PUBLIC_SITE_URL) throw new Error("NEXT_PUBLIC_SITE_URL precisa estar configurada para registrar o webhook.");

  const secret = row.webhook_secret_ciphertext ? decryptConnectionSecret(row.webhook_secret_ciphertext) : randomBytes(32).toString("base64url");
  const events = ZERNIO_WEBHOOK_EVENTS as unknown as string[];

  if (row.webhook_id) {
    // Atualizar preserva o id; o endpoint continua registrado mesmo que a URL mude de domínio.
    const updated = await updateWebhookSettings(apiKey, row.webhook_id, { events, isActive: true, secret, accountIds: [row.account_id] });
    const webhook = updated.webhook;
    await query(
      "update public.organization_zernio_connections set webhook_events = $2, webhook_secret_ciphertext = $3, webhook_registered_at = now(), updated_at = now() where organization_id = $1",
      [organizationId, webhook.events ?? events, row.webhook_secret_ciphertext ?? encryptConnectionSecret(secret)],
    );
    return { webhookId: webhook._id, url: webhook.url, events: webhook.events ?? events };
  }

  const created = await createWebhookSettings(apiKey, { name: "SGA", url, events, secret, accountIds: [row.account_id] });
  const webhook = created.webhook;
  await query(
    "update public.organization_zernio_connections set webhook_id = $2, webhook_events = $3, webhook_secret_ciphertext = $4, webhook_registered_at = now(), updated_at = now() where organization_id = $1",
    [organizationId, webhook._id, webhook.events ?? events, encryptConnectionSecret(secret)],
  );
  return { webhookId: webhook._id, url: webhook.url, events: webhook.events ?? events };
}

export async function unregisterWebhook(organizationId: string) {
  const { row, apiKey } = await requireZernioConnection(organizationId);
  if (!row.webhook_id) return;
  try {
    await deleteWebhookSettings(apiKey, row.webhook_id);
  } catch (error) {
    // Um endpoint já removido no painel da Zernio não deve impedir a limpeza local.
    if (!(error instanceof ZernioApiError) || error.status !== 404) throw error;
  }
  await query(
    "update public.organization_zernio_connections set webhook_id = null, webhook_events = array[]::text[], webhook_secret_ciphertext = null, webhook_registered_at = null, updated_at = now() where organization_id = $1",
    [organizationId],
  );
}
