import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requestPasswordReset } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/auth-card";

type Props = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function RecoverPasswordPage({ searchParams }: Readonly<Props>) {
  const { error, notice } = await searchParams;

  return (
    <AuthCard
      description="Informe seu e-mail e enviaremos um link para redefinir a senha."
      error={error}
      notice={notice}
      title="Recuperar senha"
    >
      <form action={requestPasswordReset} className="auth-form">
        <label htmlFor="email">E-mail</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <SubmitButton pendingLabel="Enviando…">Enviar link de redefinição</SubmitButton>
      </form>
      <p className="auth-footer"><Link href="/login">Voltar ao login</Link></p>
    </AuthCard>
  );
}
