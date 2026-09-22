"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateApiToken } from "@/lib/integrations/api-token";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2, "Informe um nome com 2 a 80 caracteres.").max(80),
  scopes: z.array(z.enum(["messaging:send", "messaging:read", "invoices:read", "tenants:read", "contracts:read"])).min(1, "Selecione ao menos um escopo."),
  expiresInDays: z.union([z.literal(0), z.number().int().min(1).max(3650)]),
});

const revokeSchema = z.object({ organizationId: z.string().uuid(), tokenId: z.string().uuid() });
const deliverySchema = z.object({ organizationId: z.string().uuid(), delivery: z.enum(["sga", "n8n"]) });

export async function createApiToken(input: unknown): Promise<{ token?: string; error?: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados do token inválidos." };

  const expiresAt = parsed.data.expiresInDays === 0 ? null : new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  const { raw, prefix, hash } = generateApiToken();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_organization_api_token", {
    target_organization_id: parsed.data.organizationId,
    token_name: parsed.data.name,
    token_hash: hash,
    token_prefix_value: prefix,
    token_scopes: parsed.data.scopes,
    token_expires_at: expiresAt,
  });
  if (error) {
    logger.error("api_token.create_failed", { code: error.code, message: error.message, organizationId: parsed.data.organizationId });
    return { error: `Não foi possível criar o token: ${error.message}` };
  }

  revalidatePath("/configuracoes/integracoes");
  return { token: raw };
}

export async function revokeApiToken(input: unknown): Promise<{ error?: string }> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { error: "Token inválido." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_organization_api_token", {
    target_organization_id: parsed.data.organizationId,
    target_token_id: parsed.data.tokenId,
  });
  if (error) {
    logger.error("api_token.revoke_failed", { code: error.code, message: error.message, tokenId: parsed.data.tokenId });
    return { error: `Não foi possível revogar o token: ${error.message}` };
  }

  revalidatePath("/configuracoes/integracoes");
  return {};
}

export async function setWhatsappDelivery(input: unknown): Promise<{ error?: string }> {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { error: "Opção inválida." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_organization_messaging_settings", {
    target_organization_id: parsed.data.organizationId,
    delivery: parsed.data.delivery,
  });
  if (error) return { error: "Não foi possível salvar a configuração." };

  revalidatePath("/comunicacao/canais");
  return {};
}
