import { NextResponse } from "next/server";
import { z } from "zod";
import { messageRetrySchema } from "@/features/messaging/messaging-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ messageId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const payload: unknown = await request.json().catch(() => null);
  const { messageId } = await params;
  const parsed = messageRetrySchema.safeParse({ ...(typeof payload === "object" && payload !== null ? payload : {}), messageId });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("retry_message", { target_organization_id: parsed.data.organizationId, target_message_id: parsed.data.messageId });
  if (error) return NextResponse.json({ error: "Não foi possível reenviar a mensagem." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
