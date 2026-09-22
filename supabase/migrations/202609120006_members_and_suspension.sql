create or replace function public.list_organization_members(target_organization_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.organization_role,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_organization_member(target_organization_id) then
    raise exception 'organization membership is required';
  end if;

  return query
  select m.user_id, coalesce(nullif(p.full_name, ''), 'Sem nome'), u.email, m.role, m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = target_organization_id
  order by m.created_at asc;
end;
$$;

create or replace function public.add_organization_member(
  target_organization_id uuid,
  member_email text,
  member_role public.organization_role
)
returns void
language plpgsql security definer set search_path = public
as $$
declare target_user_id uuid;
begin
  if not public.is_organization_owner(target_organization_id) then
    raise exception 'organization owner role is required';
  end if;
  if member_role = 'owner' then raise exception 'ownership transfer requires a dedicated flow'; end if;
  if not exists (select 1 from public.organizations where id = target_organization_id and status = 'active') then
    raise exception 'organization must be active';
  end if;
  select id into target_user_id from auth.users where lower(email) = lower(btrim(member_email)) limit 1;
  if target_user_id is null then raise exception 'account not found'; end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (target_organization_id, target_user_id, member_role)
  on conflict (organization_id, user_id) do update set role = excluded.role
  where public.organization_members.role <> 'owner';
  if not found then raise exception 'owner role cannot be changed'; end if;
end;
$$;

create or replace function public.update_organization_member_role(
  target_organization_id uuid,
  target_user_id uuid,
  member_role public.organization_role
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_organization_owner(target_organization_id) then raise exception 'organization owner role is required'; end if;
  if member_role = 'owner' then raise exception 'ownership transfer requires a dedicated flow'; end if;
  update public.organization_members set role = member_role
  where organization_id = target_organization_id and user_id = target_user_id and role <> 'owner';
  if not found then raise exception 'member not found or protected owner'; end if;
end;
$$;

create or replace function public.remove_organization_member(target_organization_id uuid, target_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_organization_owner(target_organization_id) then raise exception 'organization owner role is required'; end if;
  delete from public.organization_members
  where organization_id = target_organization_id and user_id = target_user_id and role <> 'owner';
  if not found then raise exception 'member not found or protected owner'; end if;
end;
$$;

create or replace function public.reactivate_organization(target_organization_id uuid)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare reactivated_organization public.organizations;
begin
  if not public.is_platform_administrator() then raise exception 'platform administrator role is required'; end if;
  update public.organizations set status = 'active'
  where id = target_organization_id and status = 'suspended'
  returning * into reactivated_organization;
  if reactivated_organization is null then raise exception 'suspended organization not found'; end if;
  return reactivated_organization;
end;
$$;

create or replace function public.list_suspended_organizations()
returns table (id uuid, name text, created_at timestamptz, owner_name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_platform_administrator() then raise exception 'platform administrator role is required'; end if;
  return query select o.id, o.name, o.created_at, coalesce(nullif(p.full_name, ''), 'Proprietário sem nome')
  from public.organizations o join public.organization_members m on m.organization_id = o.id and m.role = 'owner'
  left join public.profiles p on p.id = m.user_id where o.status = 'suspended' order by o.created_at desc;
end;
$$;

revoke all on function public.list_organization_members(uuid) from public;
revoke all on function public.add_organization_member(uuid, text, public.organization_role) from public;
revoke all on function public.update_organization_member_role(uuid, uuid, public.organization_role) from public;
revoke all on function public.remove_organization_member(uuid, uuid) from public;
revoke all on function public.reactivate_organization(uuid) from public;
revoke all on function public.list_suspended_organizations() from public;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.add_organization_member(uuid, text, public.organization_role) to authenticated;
grant execute on function public.update_organization_member_role(uuid, uuid, public.organization_role) to authenticated;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated;
grant execute on function public.reactivate_organization(uuid) to authenticated;
grant execute on function public.list_suspended_organizations() to authenticated;
