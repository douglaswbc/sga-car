import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeConnectFlow, consumeConnectSession } from "@/features/zernio/server";

export const runtime = "nodejs";

/** Destino do usuário depois do retorno da Zernio, para não perder o contexto de onde ele saiu. */
function channelsPage(params: Record<string, string | null>) {
  const target = new URL("/comunicacao/canais", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  if (params.notice) target.searchParams.set("notice", params.notice);
  if (params.error) target.searchParams.set("error", params.error);
  return NextResponse.redirect(target);
}

/**
 * Retorno do Embedded Signup da Meta, hospedado pela Zernio.
 *
 * A Zernio redireciona aqui em sucesso (`connected`, `accountId`, `username`) e em falha
 * (`error`, `platform` e, opcionalmente, `error_message`, `is_user_fixable`, `request_id`,
 * `stage`). Nenhum parâmetro é-confiável: a organização vem do nonce `sga_state`, e o
 * `accountId` é reconferido contra as contas da API key antes de ser gravado.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nonce = url.searchParams.get("sga_state");
  const error = url.searchParams.get("error");

  if (!nonce) return channelsPage({ error: "Conexão não reconhecida. Inicie o processo novamente." });
  if (error) {
    const message = url.searchParams.get("error_message") ?? error;
    const fixable = url.searchParams.get("is_user_fixable") === "true";
    return channelsPage({ error: `A conexão do WhatsApp falhou: ${message}${fixable ? " Você pode tentar novamente." : ""}` });
  }

  const accountId = url.searchParams.get("accountId");
  if (!accountId) return channelsPage({ error: "A Zernio não informou qual conta foi conectada." });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return channelsPage({ error: "Sua sessão expirou. Entre novamente para concluir a conexão." });

  try {
    const session = await consumeConnectSession(nonce);
    const { data: organizations } = await supabase.rpc("get_my_organizations");
    const allowed = organizations?.some((org) => org.id === session.organization_id && org.status === "active" && ["owner", "admin"].includes(org.role));
    if (!allowed) return channelsPage({ error: "Sem permissão para concluir esta conexão." });

    const outcome = await completeConnectFlow(session, accountId);
    if (!outcome.ok) return channelsPage({ error: outcome.error });

    await registerWebhookBestEffort(session.organization_id);
    return channelsPage({ notice: `WhatsApp conectado: ${outcome.displayName ?? outcome.accountId}.` });
  } catch (error) {
    return channelsPage({ error: error instanceof Error ? error.message : "Não foi possível concluir a conexão." });
  }
}

/**
 * Conectar o número e ouvir eventos são passos independentes. Falhar no webhook não pode
 * impedir a conexão de ser salva — a organização pode re-registrar pela tela depois.
 */
async function registerWebhookBestEffort(organizationId: string) {
  try {
    const { registerWebhook } = await import("@/features/zernio/server");
    await registerWebhook(organizationId);
  } catch (error) {
    const { logger } = await import("@/lib/observability/logger");
    logger.error("zernio.webhook_auto_register_failed", { organizationId, error: error instanceof Error ? error.message : String(error) });
  }
}
