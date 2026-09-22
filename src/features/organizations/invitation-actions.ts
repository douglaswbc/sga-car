"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const organizationIdSchema = z.string().uuid();
const memberEmailSchema = z.string().trim().email().max(254);
const memberNameSchema = z.string().trim().max(160);
const roleSchema = z.enum(["admin", "finance", "operations", "support"]);
const tokenSchema = z.string().trim().regex(/^[a-f0-9]{64}$/i);
const INVITE_TTL_DAYS = 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function acceptErrorMessage(message: string) {
  if (message.includes("expired")) return "Este convite expirou. Peça um novo convite ao administrador.";
  if (message.includes("already accepted")) return "Este convite já foi utilizado.";
  if (message.includes("does not match")) return "Você está autenticado com um e-mail diferente do convidado.";
  if (message.includes("not active")) return "A organização não está ativa.";
  return "Não foi possível aceitar o convite.";
}

export async function inviteOrganizationMember(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  const email = memberEmailSchema.safeParse(formData.get("email"));
  const role = roleSchema.safeParse(formData.get("role"));
  const name = memberNameSchema.safeParse(formData.get("name") ?? "");
  if (!organizationId.success || !email.success || !role.success) redirect("/configuracoes/equipe?error=Dados do convite inválidos.");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) redirect("/configuracoes/equipe?error=NEXT_PUBLIC_SITE_URL não está configurada.");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_organization_invitation", {
    target_organization_id: organizationId.data,
    member_email: email.data,
    member_role: role.data,
    invitation_token_hash: hashToken(token),
    invitation_expires_at: expiresAt,
  });
  if (error) redirect("/configuracoes/equipe?error=Não foi possível criar o convite.");

  const { error: queueError } = await supabase.rpc("enqueue_organization_invite", {
    target_organization_id: organizationId.data,
    member_email: email.data,
    member_name: name.success ? name.data : "",
    invite_url: new URL(`/convite/${token}`, siteUrl).toString(),
  });
  revalidatePath("/configuracoes/equipe");
  if (queueError) redirect("/configuracoes/equipe?error=Convite registrado, mas o e-mail não pôde ser enfileirado.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "member.invited", entityType: "organization_invitation", summary: `Convite enviado para ${email.data}`, metadata: { role: role.data } });
  redirect("/configuracoes/equipe?notice=Convite enviado por e-mail.");
}

export async function revokeOrganizationInvitation(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  const invitationId = organizationIdSchema.safeParse(formData.get("invitationId"));
  if (!organizationId.success || !invitationId.success) redirect("/configuracoes/equipe?error=Convite inválido.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_organization_invitation", {
    target_organization_id: organizationId.data,
    target_invitation_id: invitationId.data,
  });
  if (error) redirect("/configuracoes/equipe?error=Não foi possível revogar o convite.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "member.invite_revoked", entityType: "organization_invitation", entityId: invitationId.data, summary: "Convite revogado" });
  revalidatePath("/configuracoes/equipe");
  redirect("/configuracoes/equipe?notice=Convite revogado.");
}

export async function acceptOrganizationInvitation(formData: FormData) {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) redirect("/login?error=Convite inválido.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/convite/${token.data}`)}`);

  const { data: organizationId, error } = await supabase.rpc("accept_organization_invitation", {
    invitation_token_hash: hashToken(token.data),
  });
  if (error) redirect(`/convite/${token.data}?error=${encodeURIComponent(acceptErrorMessage(error.message))}`);

  if (organizationId) {
    await recordAudit(supabase, { organizationId, action: "member.invite_accepted", entityType: "organization_member", summary: "Convite aceito e vínculo ativado" });
  }
  revalidatePath("/");
  redirect("/?notice=Convite aceito. Bem-vindo à equipe.");
}
