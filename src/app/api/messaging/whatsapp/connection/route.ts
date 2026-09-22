import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptConnectionSecret } from "@/lib/messaging/connection-crypto";
import { query } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ organizationId: z.string().uuid(), businessAccountId: z.string().trim().min(1).max(100), phoneNumberId: z.string().trim().min(1).max(100), accessToken: z.string().trim().min(20).max(4096) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: organizations } = await supabase.rpc("get_my_organizations"); const allowed = organizations?.some((org) => org.id === parsed.data.organizationId && org.status === "active" && ["owner", "admin"].includes(org.role)); if (!allowed) return NextResponse.json({ error: "Sem permissão para configurar esta organização." }, { status: 403 });
  try { await query("insert into public.organization_whatsapp_connections (organization_id, business_account_id, phone_number_id, access_token_ciphertext) values ($1,$2,$3,$4) on conflict (organization_id) do update set business_account_id=excluded.business_account_id, phone_number_id=excluded.phone_number_id, access_token_ciphertext=excluded.access_token_ciphertext", [parsed.data.organizationId, parsed.data.businessAccountId, parsed.data.phoneNumberId, encryptConnectionSecret(parsed.data.accessToken)]); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "Não foi possível salvar a conexão. Verifique a configuração do servidor e tente novamente." }, { status: 500 }); }
}
