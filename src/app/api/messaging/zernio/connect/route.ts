import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startConnectFlow } from "@/features/zernio/server";
import { ZernioApiError } from "@/features/zernio/api-client";

export const runtime = "nodejs";

const schema = z.object({ organizationId: z.string().uuid(), brandName: z.string().trim().max(60).optional() });

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
    return NextResponse.json({ ok: true, authUrl: await startConnectFlow(parsed.data.organizationId, parsed.data.brandName) });
  } catch (error) {
    if (error instanceof ZernioApiError) return NextResponse.json({ error: `O Zernio recusou a conexão: ${error.message}` }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a conexão." }, { status: 400 });
  }
}
