import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { signUp } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/auth-card";

type SignUpPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function SignUpPage({ searchParams }: Readonly<SignUpPageProps>) {
  const { error, next: rawNext } = await searchParams;
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  return (
    <AuthCard
      description="Crie sua conta. Você confirmará seu e-mail antes de acessar o sistema."
      error={error}
      title="Criar conta"
    >
      <form action={signUp} className="auth-form">
        {next !== "/" ? <input name="next" type="hidden" value={next} /> : null}
        <label htmlFor="fullName">Nome completo</label>
        <input autoComplete="name" id="fullName" maxLength={160} name="fullName" required type="text" />
        <label htmlFor="email">E-mail</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <label htmlFor="password">Senha</label>
        <input autoComplete="new-password" id="password" minLength={12} name="password" required type="password" />
        <p className="field-hint">Use pelo menos 12 caracteres.</p>
        <SubmitButton pendingLabel="Criando…">Criar conta</SubmitButton>
      </form>
      <p className="auth-footer">Já possui conta? <Link href={next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Entrar</Link></p>
    </AuthCard>
  );
}
