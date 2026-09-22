create or replace function public.get_tenant_address(target_organization_id uuid, target_tenant_id uuid)
returns table (postal_code text, street text, number text, complement text, neighborhood text, city text, state text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select a.postal_code, a.street, a.number, a.complement, a.neighborhood, a.city, a.state
  from public.tenant_addresses a where a.organization_id = target_organization_id and a.tenant_id = target_tenant_id;
end;
$$;

create or replace function public.upsert_tenant_address(
  target_organization_id uuid, target_tenant_id uuid, address_postal_code text, address_street text,
  address_number text, address_complement text, address_neighborhood text, address_city text, address_state text
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  insert into public.tenant_addresses (tenant_id, organization_id, postal_code, street, number, complement, neighborhood, city, state)
  values (target_tenant_id, target_organization_id, address_postal_code, address_street, address_number, nullif(address_complement, ''), address_neighborhood, address_city, address_state)
  on conflict (tenant_id) do update set postal_code = excluded.postal_code, street = excluded.street, number = excluded.number, complement = excluded.complement, neighborhood = excluded.neighborhood, city = excluded.city, state = excluded.state;
end;
$$;

revoke all on function public.get_tenant_address(uuid, uuid) from public;
revoke all on function public.upsert_tenant_address(uuid, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.get_tenant_address(uuid, uuid) to authenticated;
grant execute on function public.upsert_tenant_address(uuid, uuid, text, text, text, text, text, text, text) to authenticated;
