import { NextResponse } from "next/server";
import { z } from "zod";
import { sendResendTestEmail, verifyResendConnection } from "@/lib/messaging/diagnostics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z.object({ to: z.union([z.literal(""), z.string().trim().email("Informe um e-mail válido.").max(254)]).optional().default("") });

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: isMaster } = await supabase.rpc("is_platform_administrator");
  if (!isMaster) return NextResponse.json({ error: "Acesso restrito ao administrador da plataforma." }, { status: 403 });
  const verification = await verifyResendConnection();
  if (!verification.ok || !parsed.data.to) return NextResponse.json({ verification, result: null });
  const result = await sendResendTestEmail(parsed.data.to);
  return NextResponse.json({ verification, result });
}
