import { NextResponse } from "next/server";
import { dispatchPendingMessages } from "@/lib/messaging/dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const result = await dispatchPendingMessages();
  return NextResponse.json(result);
}
