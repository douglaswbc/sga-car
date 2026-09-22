create or replace function public.get_my_organizations()
returns table (
  id uuid,
  name text,
  status public.organization_status,
  role public.organization_role,
  created_at timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select o.id, o.name, o.status, m.role, o.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
  order by o.created_at desc;
$$;

create or replace function public.list_pending_organizations()
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
  select o.id, o.name, o.created_at, coalesce(nullif(p.full_name, ''), 'Solicitante sem nome')
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id and m.role = 'owner'
  left join public.profiles p on p.id = m.user_id
  where o.status = 'pending'
  order by o.created_at asc;
end;
$$;

revoke all on function public.get_my_organizations() from public;
revoke all on function public.list_pending_organizations() from public;
grant execute on function public.get_my_organizations() to authenticated;
grant execute on function public.list_pending_organizations() to authenticated;
