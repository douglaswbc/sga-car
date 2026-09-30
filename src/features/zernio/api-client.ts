// Cliente HTTP da API do Zernio (https://zernio.com/api/v1), autenticado por API key
// da propria organizacao. A chave nunca e lida do ambiente: vem sempre da conexao
// criptografada no banco, porque cada organizacao usa a sua.

const requestTimeoutMs = 15_000;
const defaultBaseUrl = "https://zernio.com/api/v1";

export class ZernioApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ZernioApiError";
  }
}

function baseUrl() {
  return (process.env.ZERNIO_API_BASE_URL ?? defaultBaseUrl).replace(/\/$/, "");
}

async function request<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  if (!apiKey) throw new ZernioApiError("A API key do Zernio não está configurada para esta organização.", 401);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      signal: controller.signal,
      cache: "no-store",
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw toApiError(data, response.status);
    return data as T;
  } catch (error) {
    if (error instanceof ZernioApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ZernioApiError("Tempo esgotado ao falar com o Zernio.", 504);
    throw new ZernioApiError("Não foi possível conectar ao Zernio.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function toApiError(data: unknown, status: number) {
  const body = data as { message?: string; error?: string | { message?: string; code?: string }; code?: string } | null;
  const nested = typeof body?.error === "object" ? body.error : undefined;
  const message = nested?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : undefined) ?? `O Zernio respondeu com status ${status}.`;
  return new ZernioApiError(message, status, nested?.code ?? body?.code);
}

export type ZernioAccount = {
  _id: string;
  platform: string;
  displayName?: string;
  username?: string;
  isActive?: boolean;
  profileId?: { _id: string; name?: string; slug?: string };
};

/** Contas conectadas na Zernio. Usado para a organizacao descobrir o `accountId` do WhatsApp. */
export function listAccounts(apiKey: string) {
  return request<{ accounts?: ZernioAccount[] }>(apiKey, "/accounts?platform=whatsapp");
}

export type ZernioTemplate = {
  id: string;
  name: string;
  status: string;
  category?: string;
  language?: string;
  rejected_reason?: string;
  rejectedReason?: string;
};

export function listWhatsAppTemplates(apiKey: string, accountId: string) {
  return request<{ templates?: ZernioTemplate[]; data?: ZernioTemplate[] }>(apiKey, `/whatsapp/templates?accountId=${encodeURIComponent(accountId)}`);
}

export function createWhatsAppTemplate(
  apiKey: string,
  body: { accountId: string; name: string; category: string; language: string; parameterFormat?: "POSITIONAL" | "NAMED"; components: unknown[] },
) {
  return request<{ success?: boolean; template?: ZernioTemplate }>(apiKey, "/whatsapp/templates", { method: "POST", body: JSON.stringify(body) });
}

export type SendTemplateInput = {
  accountId: string;
  to: string;
  templateName: string;
  templateLanguage: string;
  templateParams: string[];
  text?: string;
};

/**
 * Abre uma conversa no inbox do Zernio. Para WhatsApp, todo envio precisa partir de um
 * modelo aprovado: a Meta nao permite texto livre para abrir conversa, entao a API
 * responde TEMPLATE_REQUIRED sem `templateName`. A resposta traz `wamid`, que e o
 * identificador que a SGA grava como `provider_message_id`.
 */
export function createConversation(apiKey: string, input: SendTemplateInput) {
  return request<{ conversationId?: string; messageId?: string; wamid?: string; platformMessageId?: string }>(apiKey, "/inbox/conversations", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      participantId: input.to,
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      templateParams: input.templateParams,
      ...(input.text ? { message: input.text } : {}),
    }),
  });
}

/** Converte o telefone para o formato internacional aceito pela Zernio (apenas dígitos, com código do país). */
export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 15 || digits.length < 8 ? null : digits;
}

export type ConnectUrlInput = {
  profileId?: string;
  redirectUrl: string;
  brandName?: string;
  primaryColor?: string;
  language?: "en" | "es" | "pt-BR";
};

/**
 * Inicia o fluxo de conexão de um número de WhatsApp e devolve a URL para onde o
 * administrador deve ser levado.
 *
 * `signup=hosted` faz a Zernio hospedar a tela e abrir o Embedded Signup da Meta dentro
 * dela. Isso evita o problema do fluxo direto: quando o login do Facebook enxerga vários
 * números, a Meta devolve só um código de autorização e o usuário cai no seletor de
 * número da Zernio, tendo que escolher de novo. Com `hosted`, a Zernio aprende qual WABA
 * e qual número foram escolhidos dentro do popup e conecta exatamente aquele.
 */
export function getWhatsAppConnectUrl(apiKey: string, input: ConnectUrlInput) {
  const query = new URLSearchParams({
    redirect_url: input.redirectUrl,
    onboarding: "api",
    signup: "hosted",
    language: input.language ?? "pt-BR",
  });
  if (input.profileId) query.set("profileId", input.profileId);
  if (input.brandName) query.set("brandName", input.brandName);
  if (input.primaryColor) query.set("primaryColor", input.primaryColor);
  return request<{ authUrl?: string }>(apiKey, `/connect/whatsapp?${query.toString()}`);
}

export type WebhookSettings = {
  _id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  failureCount?: number;
};

/**
 * Registra o endpoint de webhook da organização. O `secret` é escolhido pelo SGA e nunca
 * gerado pela Zernio; como cada organização registra o seu, cada secret é diferente.
 */
export function createWebhookSettings(
  apiKey: string,
  body: { name: string; url: string; events: string[]; secret: string; accountIds?: string[] },
) {
  return request<{ success?: boolean; webhook: WebhookSettings }>(apiKey, "/webhooks/settings", { method: "POST", body: JSON.stringify(body) });
}

export function listWebhookSettings(apiKey: string) {
  return request<{ webhooks?: WebhookSettings[] }>(apiKey, "/webhooks/settings");
}

export function updateWebhookSettings(apiKey: string, webhookId: string, body: { events?: string[]; isActive?: boolean; secret?: string; accountIds?: string[] }) {
  return request<{ success?: boolean; webhook: WebhookSettings }>(apiKey, `/webhooks/settings/${encodeURIComponent(webhookId)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteWebhookSettings(apiKey: string, webhookId: string) {
  return request<{ success?: boolean }>(apiKey, `/webhooks/settings/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
}
