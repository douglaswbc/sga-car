import { createHash } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { signOut } from "@/features/auth/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { acceptOrganizationInvitation } from "@/features/organizations/invitation-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> };

const tokenPattern = /^[a-f0-9]{64}$/i;
const roleLabels: Record<string, string> = { owner: "Proprietário", admin: "Administrador", finance: "Financeiro", operations: "Operações", support: "Atendimento" };

export default async function InvitationPage({ params, searchParams }: Readonly<Props>) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!tokenPattern.test(token)) redirect("/login?error=Convite inválido.");

  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, { data: invitations }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_organization_invitation", { invitation_token_hash: createHash("sha256").update(token).digest("hex") }),
  ]);
  const invitation = invitations?.[0];

  if (!invitation || invitation.accepted_at) {
    return (
      <AuthCard description="Não encontramos um convite válido para este link." title="Convite indisponível">
        <FormMessage tone="error">{invitation?.accepted_at ? "Este convite já foi utilizado." : "Convite inválido ou não encontrado."}</FormMessage>
        <p className="auth-footer"><Link href="/login">Ir para o login</Link></p>
      </AuthCard>
    );
  }

  if (new Date(invitation.expires_at).getTime() < new Date().getTime()) {
    return (
      <AuthCard description="O prazo deste convite terminou." title="Convite expirado">
        <FormMessage tone="error">Peça um novo convite ao administrador da organização.</FormMessage>
        <p className="auth-footer"><Link href="/login">Ir para o login</Link></p>
      </AuthCard>
    );
  }

  const nextPath = `/convite/${token}`;
  const signedInEmail = user?.email?.toLowerCase() ?? null;
  const invitedEmail = invitation.email;
  const matchesInvitedEmail = signedInEmail === invitedEmail.toLowerCase();

  if (!user) {
    return (
      <AuthCard description={`${invitation.organization_name} convidou ${invitedEmail} como ${roleLabels[invitation.role] ?? invitation.role}.`} title="Convite para equipe">
        {query.error ? <FormMessage tone="error">{query.error}</FormMessage> : null}
        <p className="auth-description">Entre ou crie sua conta com o e-mail <strong>{invitedEmail}</strong> para aceitar o convite.</p>
        <Link className="button" href={`/login?next=${encodeURIComponent(nextPath)}`}>Entrar</Link>
        <p className="auth-footer">Ainda não possui conta? <Link href={`/criar-conta?next=${encodeURIComponent(nextPath)}`}>Criar conta</Link></p>
      </AuthCard>
    );
  }

  if (!matchesInvitedEmail) {
    return (
      <AuthCard description={`Este convite é para ${invitedEmail}, mas você está autenticado como ${signedInEmail}.`} title="Convite para equipe">
        <FormMessage tone="error">Saia e entre com o e-mail convidado para continuar.</FormMessage>
        <form action={signOut}>
          <SubmitButton className="button button--secondary" pendingLabel="Saindo…">Sair e entrar com outro e-mail</SubmitButton>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard description={`Você foi convidado para ${invitation.organization_name} como ${roleLabels[invitation.role] ?? invitation.role}.`} title="Aceitar convite">
      {query.error ? <FormMessage tone="error">{query.error}</FormMessage> : null}
      <form action={acceptOrganizationInvitation} className="auth-form">
        <input name="token" type="hidden" value={token} />
        <SubmitButton pendingLabel="Aceitando…">Aceitar convite</SubmitButton>
      </form>
    </AuthCard>
  );
}
