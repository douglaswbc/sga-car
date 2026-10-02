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
    logger.error("zernio.connect_start_failed", {
      organizationId: parsed.data.organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Não foi possível preparar a conexão. Tente novamente; se persistir, consulte os logs do servidor." }, { status: 500 });
  }
}
