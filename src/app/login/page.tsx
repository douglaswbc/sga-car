import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { signIn } from "@/features/auth/actions";
import { AuthCard } from "@/features/auth/auth-card";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: Readonly<LoginPageProps>) {
  const { error, notice, next: rawNext } = await searchParams;
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  return (
    <AuthCard
      description="Entre com sua conta para acessar a operação da sua organização."
      error={error}
      notice={notice}
      title="Acessar o SGA"
    >
      <form action={signIn} className="auth-form">
        {next !== "/" ? <input name="next" type="hidden" value={next} /> : null}
        <label htmlFor="email">E-mail</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <label htmlFor="password">Senha</label>
        <input autoComplete="current-password" id="password" minLength={12} name="password" required type="password" />
        <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
      </form>
      <p className="auth-footer"><Link href="/recuperar-senha">Esqueci minha senha</Link></p>
      <p className="auth-footer">Ainda não possui conta? <Link href={next !== "/" ? `/criar-conta?next=${encodeURIComponent(next)}` : "/criar-conta"}>Criar conta</Link></p>
    </AuthCard>
  );
}
