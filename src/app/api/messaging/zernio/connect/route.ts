import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startConnectFlow } from "@/features/zernio/server";
import { ZernioApiError } from "@/features/zernio/api-client";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const schema = z.object({
  organizationId: z.string().uuid(),
  brandName: z.string().trim().max(60).optional(),
  apiKey: z.string().trim().min(20).max(4096).optional(),
  returnTo: z.string().max(2048).optional(),
});

function databaseErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const allowed = organizations?.some((org) => org.id === parsed.data.organizationId && org.status === "active" && ["owner", "admin"].includes(org.role));
  if (!allowed) return NextResponse.json({ error: "Sem permissão para conectar o WhatsApp desta organização." }, { status: 403 });

  try {
    return NextResponse.json({ ok: true, authUrl: await startConnectFlow(parsed.data.organizationId, parsed.data.brandName, parsed.data.apiKey, parsed.data.returnTo) });
  } catch (error) {
    if (error instanceof ZernioApiError) return NextResponse.json({ error: `O Zernio recusou a conexão: ${error.message}` }, { status: 502 });
    const code = databaseErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    logger.error("zernio.connect_start_failed", {
      organizationId: parsed.data.organizationId,
      error: message,
      code,
    });
    if (code === "42703") {
      return NextResponse.json({ error: "O banco ainda não tem a estrutura do onboarding Zernio. Aplique a migration 0002_zernio_connect_onboarding.sql e tente novamente." }, { status: 503 });
    }
    if (/connection terminated|timeout|econnreset|epipe|etimedout/i.test(message)) {
      return NextResponse.json({ error: "O SGA perdeu a conexão com o banco ao preparar o onboarding. Tente novamente em alguns instantes." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível preparar a conexão. Tente novamente; se persistir, consulte os logs do servidor." }, { status: 500 });
  }
}
