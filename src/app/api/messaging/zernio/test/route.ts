import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAccounts, ZernioApiError } from "@/features/zernio/api-client";

export const runtime = "nodejs";

const schema = z.object({ organizationId: z.string().uuid() });

/**
 * Diagnóstico da conexão do Zernio de uma organização. A credencial é descriptografada
 * no servidor e usada apenas em memória; nada é retornado além do nome da conta.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: organizations } = await supabase.rpc("get_my_organizations");
  const allowed = organizations?.some((org) => org.id === parsed.data.organizationId && org.status === "active" && ["owner", "admin"].includes(org.role));
  if (!allowed) return NextResponse.json({ error: "Sem permissão para testar esta conexão." }, { status: 403 });

  const { decryptConnectionSecret } = await import("@/lib/messaging/connection-crypto");
  const { query } = await import("@/lib/db");
  const connections = await query<{ account_id: string; api_key_ciphertext: string; display_name: string | null }>(
    "select account_id, api_key_ciphertext, display_name from public.organization_zernio_connections where organization_id = $1",
    [parsed.data.organizationId],
  );
  if (!connections[0]) return NextResponse.json({ error: "WhatsApp não está configurado para esta organização." }, { status: 409 });

  const connection = connections[0];
  try {
    const accounts = await listAccounts(decryptConnectionSecret(connection.api_key_ciphertext));
    const account = accounts.accounts?.find((item) => item._id === connection.account_id);
    if (!account) {
      return NextResponse.json({ result: { ok: false, error: "A conta configurada não aparece entre as contas de WhatsApp desta API key." } });
    }
    return NextResponse.json({ result: { ok: true, accountId: account._id, displayName: account.displayName ?? account.username ?? connection.display_name, active: account.isActive !== false, profile: account.profileId?.name ?? null } });
  } catch (error) {
    return NextResponse.json({ result: { ok: false, error: error instanceof ZernioApiError ? error.message : "Não foi possível conectar ao Zernio." } });
  }
}
