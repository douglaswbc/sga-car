import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { encryptConnectionSecret } from "@/lib/messaging/connection-crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAccounts, ZernioApiError } from "@/features/zernio/api-client";

const schema = z.object({ organizationId: z.string().uuid(), accountId: z.string().trim().min(1).max(100), apiKey: z.string().trim().min(20).max(4096) });

async function requireManager(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 }) };
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const allowed = organizations?.some((org) => org.id === organizationId && org.status === "active" && ["owner", "admin"].includes(org.role));
  if (!allowed) return { error: NextResponse.json({ error: "Sem permissão para configurar esta organização." }, { status: 403 }) };
  return {};
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const denied = await requireManager(parsed.data.organizationId);
  if ("error" in denied) return denied.error;

  // Valida a credencial contra a API antes de gravar: uma api key inválida só seria
  // descoberta no primeiro envio, quando a fila de mensagens já teria acumulado falhas.
  let displayName: string | null = null;
  try {
    const accounts = await listAccounts(parsed.data.apiKey);
    const account = accounts.accounts?.find((item) => item._id === parsed.data.accountId);
    if (!account) {
      return NextResponse.json({ error: "Nenhuma conta do WhatsApp com esse ID está conectada nesta API key." }, { status: 422 });
    }
    displayName = account.displayName ?? account.username ?? null;
  } catch (error) {
    if (error instanceof ZernioApiError) return NextResponse.json({ error: `O Zernio recusou a API key: ${error.message}` }, { status: 422 });
    throw error;
  }

  try {
    await query(
      `insert into public.organization_zernio_connections (organization_id, account_id, api_key_ciphertext, display_name)
       values ($1, $2, $3, $4)
       on conflict (organization_id) do update
         set account_id = excluded.account_id,
             api_key_ciphertext = excluded.api_key_ciphertext,
             display_name = excluded.display_name,
             updated_at = now()`,
      [parsed.data.organizationId, parsed.data.accountId, encryptConnectionSecret(parsed.data.apiKey), displayName],
    );
    return NextResponse.json({ ok: true, displayName });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar a conexão. Verifique a configuração do servidor e tente novamente." }, { status: 500 });
  }
}

const discoverySchema = z.object({ organizationId: z.string().uuid(), apiKey: z.string().trim().min(20).max(4096) });

/** Lista as contas de WhatsApp da API key informada, para a organização descobrir o `accountId`. */
export async function PUT(request: Request) {
  const parsed = discoverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const denied = await requireManager(parsed.data.organizationId);
  if ("error" in denied) return denied.error;

  try {
    const accounts = await listAccounts(parsed.data.apiKey);
    const whatsapp = (accounts.accounts ?? []).map((account) => ({ accountId: account._id, displayName: account.displayName ?? account.username ?? null, profile: account.profileId?.name ?? null, active: account.isActive !== false }));
    return NextResponse.json({ ok: true, accounts: whatsapp });
  } catch (error) {
    if (error instanceof ZernioApiError) return NextResponse.json({ error: `O Zernio recusou a API key: ${error.message}` }, { status: 422 });
    throw error;
  }
}
