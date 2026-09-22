"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const organizationNameSchema = z.string().trim().min(2).max(120);
const organizationIdSchema = z.string().uuid();
const memberEmailSchema = z.string().trim().email().max(254);
const roleSchema = z.enum(["admin", "finance", "operations", "support"]);

export async function requestOrganization(formData: FormData) {
  const organizationName = organizationNameSchema.safeParse(formData.get("name"));
  if (!organizationName.success) {
    redirect("/onboarding?error=Informe um nome entre 2 e 120 caracteres.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase.rpc("request_organization", {
    organization_name: organizationName.data,
  });

  if (error) {
    redirect("/onboarding?error=Não foi possível enviar a solicitação.");
  }

  if (created) {
    await recordAudit(supabase, { organizationId: created.id, action: "organization.requested", entityType: "organization", entityId: created.id, summary: `Solicitação da organização "${created.name}"` });
  }
  revalidatePath("/onboarding");
  redirect("/onboarding?notice=Solicitação enviada para aprovação.");
}

export async function approveOrganization(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/master?error=Organização inválida.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_organization", {
    target_organization_id: organizationId.data,
  });

  if (error) redirect("/master?error=Não foi possível aprovar a organização.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "organization.approved", entityType: "organization", entityId: organizationId.data, summary: "Organização aprovada" });
  revalidatePath("/master");
  redirect("/master?notice=Organização aprovada.");
}

export async function suspendOrganization(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/master?error=Organização inválida.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("suspend_organization", {
    target_organization_id: organizationId.data,
  });

  if (error) redirect("/master?error=Não foi possível suspender a organização.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "organization.suspended", entityType: "organization", entityId: organizationId.data, summary: "Organização suspensa" });
  revalidatePath("/master");
  redirect("/master?notice=Organização suspensa.");
}

export async function reactivateOrganization(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/master?error=Organização inválida.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reactivate_organization", { target_organization_id: organizationId.data });
  if (error) redirect("/master?error=Não foi possível reativar a organização.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "organization.reactivated", entityType: "organization", entityId: organizationId.data, summary: "Organização reativada" });
  revalidatePath("/master");
  redirect("/master?notice=Organização reativada.");
}

export async function addOrganizationMember(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  const email = memberEmailSchema.safeParse(formData.get("email"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!organizationId.success || !email.success || !role.success) redirect("/configuracoes/equipe?error=Dados do membro inválidos.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_organization_member", { target_organization_id: organizationId.data, member_email: email.data, member_role: role.data });
  if (error) redirect("/configuracoes/equipe?error=A conta não foi encontrada ou não pôde ser adicionada.");
  const { data: members } = await supabase.rpc("list_organization_members", { target_organization_id: organizationId.data });
  const member = members?.find((item) => item.email === email.data);
  await supabase.rpc("enqueue_member_invite", { target_organization_id: organizationId.data, member_email: email.data, member_name: member?.full_name ?? "" });
  revalidatePath("/configuracoes/equipe");
  redirect("/configuracoes/equipe?notice=Membro adicionado.");
}

export async function updateOrganizationMemberRole(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  const userId = organizationIdSchema.safeParse(formData.get("userId"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!organizationId.success || !userId.success || !role.success) redirect("/configuracoes/equipe?error=Dados do membro inválidos.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_organization_member_role", { target_organization_id: organizationId.data, target_user_id: userId.data, member_role: role.data });
  if (error) redirect("/configuracoes/equipe?error=Não foi possível alterar o papel do membro.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "member.role_updated", entityType: "organization_member", entityId: userId.data, summary: `Papel alterado para ${role.data}`, metadata: { role: role.data } });
  revalidatePath("/configuracoes/equipe");
  redirect("/configuracoes/equipe?notice=Papel atualizado.");
}

export async function removeOrganizationMember(formData: FormData) {
  const organizationId = organizationIdSchema.safeParse(formData.get("organizationId"));
  const userId = organizationIdSchema.safeParse(formData.get("userId"));
  if (!organizationId.success || !userId.success) redirect("/configuracoes/equipe?error=Membro inválido.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_organization_member", { target_organization_id: organizationId.data, target_user_id: userId.data });
  if (error) redirect("/configuracoes/equipe?error=Não foi possível remover o membro.");
  await recordAudit(supabase, { organizationId: organizationId.data, action: "member.removed", entityType: "organization_member", entityId: userId.data, summary: "Membro removido da organização" });
  revalidatePath("/configuracoes/equipe");
  redirect("/configuracoes/equipe?notice=Membro removido.");
}
