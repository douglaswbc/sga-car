update public.tenants
set document_number = nullif(regexp_replace(coalesce(document_number, ''), '\D', '', 'g'), ''),
    phone = case
      when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) = 11 then '55' || regexp_replace(phone, '\D', '', 'g')
      else nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
    end;

alter table public.tenants drop constraint if exists tenants_document_number_check;
alter table public.tenants drop constraint if exists tenants_phone_check;
alter table public.tenants add constraint tenants_document_number_format check (document_number is null or document_number ~ '^\d{11}$|^\d{14}$');
alter table public.tenants add constraint tenants_phone_e164_format check (phone is null or phone ~ '^55\d{2}9\d{8}$');

create or replace function public.create_tenant_with_address(
  target_organization_id uuid, tenant_full_name text, tenant_document_number text, tenant_email text, tenant_phone text,
  address_postal_code text, address_street text, address_number text, address_complement text, address_neighborhood text, address_city text, address_state text
)
returns public.tenants language plpgsql security definer set search_path = public
as $$
declare created_tenant public.tenants;
declare normalized_document text := nullif(regexp_replace(coalesce(tenant_document_number, ''), '\D', '', 'g'), '');
declare normalized_phone text := nullif(regexp_replace(coalesce(tenant_phone, ''), '\D', '', 'g'), '');
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if normalized_document is null or normalized_document !~ '^\d{11}$|^\d{14}$' then raise exception 'invalid document'; end if;
  if normalized_phone is null or normalized_phone !~ '^\d{11}$' or substring(normalized_phone from 3 for 1) <> '9' then raise exception 'invalid mobile phone'; end if;
  insert into public.tenants (organization_id, full_name, document_number, email, phone)
  values (target_organization_id, btrim(tenant_full_name), normalized_document, nullif(lower(btrim(tenant_email)), ''), '55' || normalized_phone)
  returning * into created_tenant;
  insert into public.tenant_addresses (tenant_id, organization_id, postal_code, street, number, complement, neighborhood, city, state)
  values (created_tenant.id, target_organization_id, regexp_replace(address_postal_code, '\D', '', 'g'), btrim(address_street), btrim(address_number), nullif(btrim(address_complement), ''), btrim(address_neighborhood), btrim(address_city), upper(btrim(address_state)));
  return created_tenant;
end;
$$;

revoke all on function public.create_tenant_with_address(uuid, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_tenant_with_address(uuid, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
