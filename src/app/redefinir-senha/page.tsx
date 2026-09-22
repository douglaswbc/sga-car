import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { updatePassword } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/auth-card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function ResetPasswordPage({ searchParams }: Readonly<Props>) {
  const { error, notice } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/recuperar-senha?error=${encodeURIComponent("Solicite um novo link de redefinição.")}`);

  return (
    <AuthCard
      description="Defina uma nova senha para a sua conta."
      error={error}
      notice={notice}
      title="Redefinir senha"
    >
      <form action={updatePassword} className="auth-form">
        <label htmlFor="password">Nova senha</label>
        <input autoComplete="new-password" id="password" minLength={12} name="password" required type="password" />
        <label htmlFor="confirmation">Confirme a nova senha</label>
        <input autoComplete="new-password" id="confirmation" minLength={12} name="confirmation" required type="password" />
        <p className="field-hint">Use pelo menos 12 caracteres.</p>
        <SubmitButton pendingLabel="Salvando…">Redefinir senha</SubmitButton>
      </form>
      <p className="auth-footer"><Link href="/login">Voltar ao login</Link></p>
    </AuthCard>
  );
}
