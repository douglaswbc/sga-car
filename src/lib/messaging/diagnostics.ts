import { sendEmail } from "@/lib/messaging/providers/email";

const requestTimeoutMs = 8000;

export type MessagingConfigStatus = {
  meta: { accessToken: boolean; phoneNumberId: boolean; verifyToken: boolean; appSecret: boolean; graphVersion: string; webhookUrl: string };
  email: { apiKey: boolean; from: string; senderAddress: string; replyTo: boolean; ready: boolean; missing: string[] };
};

export function getMessagingConfigStatus(): MessagingConfigStatus {
  const from = process.env.SGA_EMAIL_FROM ?? "";
  const apiKey = Boolean(process.env.RESEND_API_KEY);
  const senderMatch = /([^\s<>]+@[^\s<>]+)/.exec(from);
  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from) missing.push("SGA_EMAIL_FROM");
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const webhookUrl = siteUrl ? `${siteUrl}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  return {
    meta: {
      accessToken: Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN),
      phoneNumberId: Boolean(process.env.META_WHATSAPP_PHONE_NUMBER_ID),
      verifyToken: Boolean(process.env.META_WHATSAPP_VERIFY_TOKEN),
      appSecret: Boolean(process.env.META_WHATSAPP_APP_SECRET),
      graphVersion: process.env.META_WHATSAPP_GRAPH_VERSION ?? "v21.0",
      webhookUrl,
    },
    email: {
      apiKey,
      from,
      senderAddress: senderMatch ? senderMatch[1] : "",
      replyTo: Boolean(process.env.SGA_EMAIL_REPLY_TO),
      ready: apiKey && Boolean(from),
      missing,
    },
  };
}

export type WhatsAppConnectionResult =
  | { ok: true; phoneNumberId: string; displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string }
  | { ok: false; error: string; code?: number };

export async function verifyWhatsAppConnection(): Promise<WhatsAppConnectionResult> {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.META_WHATSAPP_GRAPH_VERSION ?? "v21.0";
  if (!accessToken || !phoneNumberId) return { ok: false, error: "Meta WhatsApp não está configurado (token ou phone number ID ausente)." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}`);
    url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal, cache: "no-store" });
    const data: { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string; code?: number } } | null = await response.json().catch(() => null);
    if (!response.ok || data?.error) return { ok: false, error: data?.error?.message ?? `A Meta respondeu com status ${response.status}.`, code: data?.error?.code };
    return { ok: true, phoneNumberId: data?.id ?? phoneNumberId, displayPhoneNumber: data?.display_phone_number, verifiedName: data?.verified_name, qualityRating: data?.quality_rating };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "AbortError" ? "Tempo esgotado ao falar com a Meta." : "Não foi possível conectar à Meta." };
  } finally {
    clearTimeout(timeout);
  }
}

export type ResendConnectionResult =
  | { ok: true; domains: { name: string; status: string }[]; senderStatus?: string }
  | { ok: false; error: string };

export async function verifyResendConnection(): Promise<ResendConnectionResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Resend não está configurado (RESEND_API_KEY ausente)." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "sga/1.0" }, signal: controller.signal, cache: "no-store" });
    const data: { data?: { name: string; status: string }[]; message?: string } | null = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: data?.message ?? `A Resend respondeu com status ${response.status}.` };
    const domains = (data?.data ?? []).map((domain) => ({ name: domain.name, status: domain.status }));
    const senderMatch = /([^\s<>]+@[^\s<>]+)/.exec(process.env.SGA_EMAIL_FROM ?? "");
    const senderDomain = senderMatch ? senderMatch[1].split("@")[1] : undefined;
    return { ok: true, domains, senderStatus: senderDomain ? domains.find((domain) => domain.name === senderDomain)?.status : undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "AbortError" ? "Tempo esgotado ao falar com a Resend." : "Não foi possível conectar à Resend." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendResendTestEmail(to: string): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  try {
    const result = await sendEmail({ to, subject: "Teste de conexão — SGA", body: "Este é um e-mail de teste enviado pelo SGA para validar a configuração do Resend." });
    return { ok: true, id: result.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível enviar o e-mail de teste." };
  }
}
