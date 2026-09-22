import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const provider = "whatsapp";

type WhatsappStatus = { id: string; status: string; timestamp: string };
type WhatsappMessage = { id: string; from?: string; type?: string };
type WhatsappPayload = { entry?: { changes?: { value?: { statuses?: WhatsappStatus[]; messages?: WhatsappMessage[] } }[] }[] };

function verifySignature(rawBody: string, signature: string | null) {
  const secret = process.env.META_WHATSAPP_APP_SECRET;
  if (!secret || !signature) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_WHATSAPP_VERIFY_TOKEN) return new Response(challenge ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const limit = rateLimit(`webhook:${clientIp(request)}`, 300, 60_000);
  if (!limit.ok) return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 403 });
  let payload: WhatsappPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsappPayload;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const status of value.statuses ?? []) {
        const externalId = `status:${status.id}:${status.status}:${status.timestamp}`;
        const inserted = await query<{ id: string }>("insert into public.webhook_events (provider, external_id, payload) values ($1, $2, $3) on conflict (provider, external_id) do nothing returning id", [provider, externalId, JSON.stringify(status)]);
        if (!inserted.length) continue;
        await query("update public.messages set status = case when $2 = 'failed' then 'failed'::public.message_status else 'sent'::public.message_status end, updated_at = now() where provider_message_id = $1", [status.id, status.status]);
        await query("update public.webhook_events set processed_at = now() where id = $1", [inserted[0].id]);
      }
      for (const message of value.messages ?? []) {
        await query("insert into public.webhook_events (provider, external_id, payload) values ($1, $2, $3) on conflict (provider, external_id) do nothing", [provider, `message:${message.id}`, JSON.stringify(message)]);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
