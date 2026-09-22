"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstValidationMessage, tenantAddressSchema, tenantSchema } from "@/features/tenants/schemas";

export async function createTenant(formData: FormData) {
  const parsedTenant = tenantSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsedTenant.success) redirect(`/locatarios?error=${encodeURIComponent(firstValidationMessage(parsedTenant.error))}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_tenant", {
    target_organization_id: parsedTenant.data.organizationId,
    tenant_full_name: parsedTenant.data.fullName,
    tenant_document_number: parsedTenant.data.documentNumber,
    tenant_email: parsedTenant.data.email,
    tenant_phone: parsedTenant.data.phone,
  });
  if (error) redirect("/locatarios?error=Não foi possível cadastrar o locatário. Verifique se o documento já existe.");
  revalidatePath("/locatarios");
  redirect("/locatarios?notice=Locatário cadastrado.");
}

export async function saveTenantAddress(formData: FormData) {
  const parsedAddress = tenantAddressSchema.safeParse(Object.fromEntries(formData.entries()));
  const fallbackPath = "/locatarios";
  if (!parsedAddress.success) redirect(`${fallbackPath}?error=${encodeURIComponent(firstValidationMessage(parsedAddress.error))}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("upsert_tenant_address", {
    target_organization_id: parsedAddress.data.organizationId,
    target_tenant_id: parsedAddress.data.tenantId,
    address_postal_code: parsedAddress.data.postalCode,
    address_street: parsedAddress.data.street,
    address_number: parsedAddress.data.number,
    address_complement: parsedAddress.data.complement,
    address_neighborhood: parsedAddress.data.neighborhood,
    address_city: parsedAddress.data.city,
    address_state: parsedAddress.data.state,
  });
  const detailPath = `/locatarios/${parsedAddress.data.tenantId}`;
  if (error) redirect(`${detailPath}?error=Não foi possível salvar o endereço.`);
  revalidatePath(detailPath);
  redirect(`${detailPath}?notice=Endereço salvo.`);
}
