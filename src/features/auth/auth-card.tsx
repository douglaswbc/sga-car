import Link from "next/link";
import type { ReactNode } from "react";

type AuthCardProps = {
  children: ReactNode;
  description: string;
  error?: string;
  notice?: string;
  title: string;
};

export function AuthCard({ children, description, error, notice, title }: Readonly<AuthCardProps>) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" href="/">SGA <span>Gestão de aluguel</span></Link>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
        {notice ? <p className="form-message form-message--notice" role="status">{notice}</p> : null}
        {children}
      </section>
    </main>
  );
}
