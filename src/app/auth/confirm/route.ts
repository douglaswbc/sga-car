import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const supportedTypes = new Set<EmailOtpType>(["email", "recovery", "invite", "email_change"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || !type || !supportedTypes.has(type as EmailOtpType)) {
    return NextResponse.redirect(new URL("/login?error=Link de confirmação inválido.", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=Não foi possível confirmar o e-mail.", url.origin));
  }

  if (type === "recovery") {
    return NextResponse.redirect(new URL("/redefinir-senha", url.origin));
  }

  const { data: { user } } = await supabase.auth.getUser();
  const metadataNext = user?.user_metadata?.invite_next;
  const next = typeof metadataNext === "string" && metadataNext.startsWith("/") && !metadataNext.startsWith("//") ? metadataNext : "/";

  return NextResponse.redirect(new URL(next, url.origin));
}
