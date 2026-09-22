create or replace function public.list_active_organizations()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  owner_name text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_platform_administrator() then
    raise exception 'platform administrator role is required';
  end if;

  return query
  select o.id, o.name, o.created_at, coalesce(nullif(p.full_name, ''), 'Proprietário sem nome')
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id and m.role = 'owner'
  left join public.profiles p on p.id = m.user_id
  where o.status = 'active'
  order by o.created_at desc;
end;
$$;

revoke all on function public.list_active_organizations() from public;
grant execute on function public.list_active_organizations() to authenticated;
