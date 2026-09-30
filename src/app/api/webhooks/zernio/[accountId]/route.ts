import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { decryptConnectionSecret } from "@/lib/messaging/connection-crypto";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

type InboxEvent = {
  id?: string;
  event?: string;
  timestamp?: string;
  account?: { accountId?: string; profileId?: string };
  message?: {
    id?: string;
    text?: string;
    direction?: "inbound" | "outbound";
    platformMessageId?: string;
    sender?: { id?: string; name?: string; phone?: string; username?: string };
    attachments?: unknown[];
  };
  conversation?: { id?: string; participantId?: string; participantName?: string };
  error?: { code?: string | number; message?: string } | null;
  template?: { name?: string; id?: string; status?: string; rejectedReason?: string };
  profile?: { name?: string };
};

/**
 * A assinatura é HMAC-SHA256 do corpo **cru**, então o corpo precisa ser lido antes de
 * qualquer parse. `X-Late-Signature` é o alias legado do mesmo valor.
 */
function verifySignature(rawBody: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(header, "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;

  // O corpo cru é lido primeiro: qualquer parse antes invalidaria a assinatura.
  const rawBody = await request.text();

  const connection = await query<{ organization_id: string; webhook_secret_ciphertext: string | null }>(
    "select organization_id, webhook_secret_ciphertext from public.organization_zernio_connections where account_id = $1 and webhook_secret_ciphertext is not null",
    [accountId],
  );
  const found = connection[0];
  if (!found) return NextResponse.json({ error: "Webhook não registrado." }, { status: 404 });

  const secret = decryptConnectionSecret(found.webhook_secret_ciphertext as string);
  const signature = request.headers.get("x-zernio-signature") ?? request.headers.get("x-late-signature");
  if (!verifySignature(rawBody, signature, secret)) {
    // Sem assinatura válida a requisição não veio do Zernio, ou o corpo foi alterado.
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload: InboxEvent;
  try {
    payload = JSON.parse(rawBody) as InboxEvent;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const organizationId = found.organization_id;
  // A Zernio entrega no mínimo uma vez e repete o mesmo id em cada tentativa; o
  // `payload.id` é a chave de deduplicação. O insert conflitante encerra o fluxo.
  const eventId = payload.id ?? request.headers.get("x-zernio-event-id");
  if (!eventId) return NextResponse.json({ ok: true, ignored: "sem id" });

  const inserted = await query<{ id: string }>(
    `insert into public.webhook_events (provider, external_id, organization_id, payload)
     values ('zernio', $1, $2, $3)
     on conflict (provider, external_id) do nothing
     returning id`,
    [eventId, organizationId, JSON.stringify(payload)],
  );
  if (!inserted[0]) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await handleEvent(organizationId, accountId, payload);
    await query("update public.webhook_events set processed_at = now() where id = $1", [inserted[0].id]);
  } catch (error) {
    logger.error("zernio.webhook_failed", { organizationId, event: payload.event, error: error instanceof Error ? error.message : String(error) });
    // Um 500 faz a Zernio repetir com backoff, e a deduplicação impede o efeito duplo.
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(organizationId: string, accountId: string, payload: InboxEvent) {
  switch (payload.event) {
    case "message.received":
      await handleInbound(organizationId, accountId, payload);
      return;
    case "message.delivered":
    case "message.read":
    case "message.failed":
      await updateOutboundStatus(organizationId, payload);
      return;
    case "whatsapp.template.status_updated":
      await updateTemplateStatus(organizationId, payload);
      return;
    case "account.disconnected":
      logger.warn("zernio.account_disconnected", { organizationId, accountId });
      return;
    default:
      return;
  }
}

/** A resposta do locatário é arquivada e fica consultável; não dispara nenhum envio. */
async function handleInbound(organizationId: string, accountId: string, payload: InboxEvent) {
  const message = payload.message;
  const messageId = message?.id;
  if (!messageId) return;

  const sender = message?.sender;
  await query(
    `insert into public.zernio_inbound_messages (organization_id, account_id, zernio_message_id, platform_message_id, conversation_id, sender, text, attachments, received_at, processed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()), now())
     on conflict (organization_id, zernio_message_id) do nothing`,
    [
      organizationId,
      accountId,
      messageId,
      message?.platformMessageId ?? null,
      payload.conversation?.id ?? null,
      sender?.phone ?? sender?.username ?? sender?.name ?? null,
      message?.text ?? null,
      JSON.stringify(message?.attachments ?? []),
      payload.timestamp ?? null,
    ],
  );
}

/** O `platformMessageId` da Zernio é o `wamid` que a SGA gravou como `provider_message_id`. */
async function updateOutboundStatus(organizationId: string, payload: InboxEvent) {
  const platformMessageId = payload.message?.platformMessageId;
  if (!platformMessageId) return;

  const status = payload.event === "message.failed" ? "failed" : payload.event === "message.delivered" ? "sent" : null;
  if (!status) return;

  await query(
    "update public.messages set status = $3, updated_at = now() where organization_id = $1 and provider_message_id = $2 and status in ('pending', 'processing', 'sent')",
    [organizationId, platformMessageId, status],
  );

  if (payload.event === "message.failed") {
    logger.warn("zernio.message_failed", { organizationId, code: payload.error?.code ?? null, message: payload.error?.message ?? null });
  }
}

async function updateTemplateStatus(organizationId: string, payload: InboxEvent) {
  const name = payload.template?.name;
  if (!name) return;
  const status = (payload.template?.status ?? "").toLowerCase();
  const allowed = ["pending", "approved", "rejected", "paused", "disabled"];
  await query(
    "update public.zernio_whatsapp_templates set status = $3, rejection_reason = $4, zernio_template_id = coalesce($5, zernio_template_id), last_synced_at = now(), updated_at = now() where organization_id = $1 and name = $2",
    [organizationId, name, allowed.includes(status) ? status : "unknown", payload.template?.rejectedReason ?? null, payload.template?.id ?? null],
  );
}
