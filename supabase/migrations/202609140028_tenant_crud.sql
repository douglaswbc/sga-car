create or replace function public.update_tenant(
  target_organization_id uuid, target_tenant_id uuid, tenant_full_name text, tenant_document_number text,
  tenant_email text, tenant_phone text, tenant_status public.tenant_status
)
returns public.tenants language plpgsql security definer set search_path = public
as $$
declare updated_tenant public.tenants;
declare normalized_document text := nullif(regexp_replace(coalesce(tenant_document_number, ''), '\D', '', 'g'), '');
declare normalized_phone text := nullif(regexp_replace(coalesce(tenant_phone, ''), '\D', '', 'g'), '');
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if char_length(btrim(coalesce(tenant_full_name, ''))) < 2 then raise exception 'invalid full name'; end if;
  if normalized_document is not null and normalized_document !~ '^\d{11}$|^\d{14}$' then raise exception 'invalid document'; end if;
  if normalized_phone is not null and (normalized_phone !~ '^\d{11}$' or substring(normalized_phone from 3 for 1) <> '9') then raise exception 'invalid mobile phone'; end if;
  update public.tenants
  set full_name = btrim(tenant_full_name),
      document_number = normalized_document,
      email = nullif(lower(btrim(tenant_email)), ''),
      phone = case when normalized_phone is null then null else '55' || normalized_phone end,
      status = tenant_status
  where id = target_tenant_id and organization_id = target_organization_id
  returning * into updated_tenant;
  if updated_tenant.id is null then raise exception 'tenant not found'; end if;
  return updated_tenant;
end;
$$;

create or replace function public.delete_tenant(target_organization_id uuid, target_tenant_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  if exists (select 1 from public.rental_contracts where tenant_id = target_tenant_id and organization_id = target_organization_id)
    or exists (select 1 from public.invoices where tenant_id = target_tenant_id and organization_id = target_organization_id) then
    raise exception 'tenant has history';
  end if;
  delete from public.tenants where id = target_tenant_id and organization_id = target_organization_id;
end;
$$;

revoke all on function public.update_tenant(uuid, uuid, text, text, text, text, public.tenant_status) from public;
revoke all on function public.delete_tenant(uuid, uuid) from public;
grant execute on function public.update_tenant(uuid, uuid, text, text, text, text, public.tenant_status) to authenticated;
grant execute on function public.delete_tenant(uuid, uuid) to authenticated;
