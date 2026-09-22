import { NextResponse } from "next/server";
import { verifyWhatsAppConnection } from "@/lib/messaging/diagnostics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { data: isMaster } = await supabase.rpc("is_platform_administrator");
  if (!isMaster) return NextResponse.json({ error: "Acesso restrito ao administrador da plataforma." }, { status: 403 });
  const result = await verifyWhatsAppConnection();
  return NextResponse.json({ result });
}
