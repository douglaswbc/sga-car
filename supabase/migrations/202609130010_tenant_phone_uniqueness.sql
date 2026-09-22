create unique index if not exists tenants_organization_phone_unique_idx
  on public.tenants (organization_id, phone)
  where phone is not null;

create or replace function public.tenant_phone_exists(target_organization_id uuid, tenant_phone text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare normalized_phone text := regexp_replace(coalesce(tenant_phone, ''), '\D', '', 'g');
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  return exists (select 1 from public.tenants where organization_id = target_organization_id and phone = '55' || normalized_phone);
end;
$$;

revoke all on function public.tenant_phone_exists(uuid, text) from public;
grant execute on function public.tenant_phone_exists(uuid, text) to authenticated;
