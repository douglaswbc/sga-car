import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  readZernioConnectionRow,
  registerWebhook,
  unregisterWebhook,
  webhookUrlFor,
  ZERNIO_WEBHOOK_EVENTS,
} from "@/features/zernio/server";
import { ZernioApiError } from "@/features/zernio/api-client";

export const runtime = "nodejs";

const querySchema = z.object({ organizationId: z.string().uuid() });
const actionSchema = z.object({ organizationId: z.string().uuid(), action: z.enum(["register", "unregister"]) });
const urlSchema = z.object({ accountId: z.string().trim().min(1).max(100) });

async function requireManager(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const allowed = organizations?.some((org) => org.id === organizationId && org.status === "active" && ["owner", "admin"].includes(org.role));
  if (!allowed) return NextResponse.json({ error: "Sem permissão para gerenciar o webhook desta organização." }, { status: 403 });
  return null;
}

/**
 * Estado do webhook da organização, lido direto do servidor: a tela não deve depender de
 * uma RPC para mostrar o que já está registrado.
 */
export async function GET(request: Request) {
  const parsed = querySchema.safeParse({ organizationId: new URL(request.url).searchParams.get("organizationId") });
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const denied = await requireManager(parsed.data.organizationId);
  if (denied) return denied;

  const row = await readZernioConnectionRow(parsed.data.organizationId);
  return NextResponse.json({
    ok: true,
    registered: Boolean(row?.webhook_id),
    registeredAt: row?.webhook_registered_at ?? null,
    events: row?.webhook_events ?? [],
    supportedEvents: ZERNIO_WEBHOOK_EVENTS,
    url: row ? webhookUrlFor(row.account_id) : null,
  });
}

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const denied = await requireManager(parsed.data.organizationId);
  if (denied) return denied;

  try {
    if (parsed.data.action === "unregister") {
      await unregisterWebhook(parsed.data.organizationId);
      return NextResponse.json({ ok: true, registered: false });
    }
    const webhook = await registerWebhook(parsed.data.organizationId);
    return NextResponse.json({ ok: true, registered: true, webhookId: webhook.webhookId, url: webhook.url, events: webhook.events });
  } catch (error) {
    if (error instanceof ZernioApiError) {
      // A Zernio recusa a assinatura quando o plano não inclui a caixa de entrada.
      const hint = error.code === "feature_not_available" ? " O plano da Zernio precisa incluir a caixa de entrada." : "";
      return NextResponse.json({ error: `O Zernio recusou o registro: ${error.message}.${hint}` }, { status: 422 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível registrar o webhook." }, { status: 400 });
  }
}

/** A URL é montada no servidor para a tela exibir exatamente o que a Zernio recebe. */
export async function PUT(request: Request) {
  const parsed = urlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  return NextResponse.json({ ok: true, url: webhookUrlFor(parsed.data.accountId) });
}
