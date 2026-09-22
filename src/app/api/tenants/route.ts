import { NextResponse } from "next/server";
import { tenantRegistrationSchema, validationMessage } from "@/features/tenants/registration-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsedTenant = tenantRegistrationSchema.safeParse(payload);
  if (!parsedTenant.success) return NextResponse.json({ error: validationMessage(parsedTenant.error) }, { status: 422 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  const { error } = await supabase.rpc("create_tenant_with_address", {
    target_organization_id: parsedTenant.data.organizationId, tenant_full_name: parsedTenant.data.fullName, tenant_document_number: parsedTenant.data.documentNumber, tenant_email: parsedTenant.data.email, tenant_phone: parsedTenant.data.phone,
    address_postal_code: parsedTenant.data.postalCode, address_street: parsedTenant.data.street, address_number: parsedTenant.data.number, address_complement: parsedTenant.data.complement, address_neighborhood: parsedTenant.data.neighborhood, address_city: parsedTenant.data.city, address_state: parsedTenant.data.state,
  });
  if (error) return NextResponse.json({ error: "Não foi possível cadastrar. CPF/CNPJ pode já estar em uso." }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
