do $$
begin
  create type public.organization_status as enum ('pending', 'active', 'suspended');
exception
  when duplicate_object then null;
end $$;

alter table public.organizations
  add column if not exists status public.organization_status not null default 'pending';

create index if not exists organizations_status_created_at_idx
  on public.organizations (status, created_at desc);

create table if not exists public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_administrator()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.platform_administrators where user_id = auth.uid()); $$;

create or replace function public.request_organization(organization_name text)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare created_organization public.organizations;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if char_length(btrim(coalesce(organization_name, ''))) not between 2 and 120 then raise exception 'invalid organization name'; end if;
  insert into public.organizations (name, status) values (btrim(organization_name), 'pending') returning * into created_organization;
  insert into public.organization_members (organization_id, user_id, role) values (created_organization.id, auth.uid(), 'owner');
  return created_organization;
end;
$$;

create or replace function public.approve_organization(target_organization_id uuid)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare approved_organization public.organizations;
begin
  if not public.is_platform_administrator() then raise exception 'platform administrator role is required'; end if;
  update public.organizations set status = 'active' where id = target_organization_id and status = 'pending' returning * into approved_organization;
  if approved_organization is null then raise exception 'pending organization not found'; end if;
  return approved_organization;
end;
$$;

create or replace function public.suspend_organization(target_organization_id uuid)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare suspended_organization public.organizations;
begin
  if not public.is_platform_administrator() then raise exception 'platform administrator role is required'; end if;
  update public.organizations set status = 'suspended' where id = target_organization_id and status = 'active' returning * into suspended_organization;
  if suspended_organization is null then raise exception 'active organization not found'; end if;
  return suspended_organization;
end;
$$;

create or replace function public.create_organization(organization_name text)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare created_organization public.organizations;
begin
  if not public.is_platform_administrator() then raise exception 'platform administrator role is required'; end if;
  if char_length(btrim(coalesce(organization_name, ''))) not between 2 and 120 then raise exception 'invalid organization name'; end if;
  insert into public.organizations (name, status) values (btrim(organization_name), 'active') returning * into created_organization;
  insert into public.organization_members (organization_id, user_id, role) values (created_organization.id, auth.uid(), 'owner');
  return created_organization;
end;
$$;

alter table public.platform_administrators enable row level security;
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;

drop policy if exists organizations_select_platform_administrator on public.organizations;
create policy organizations_select_platform_administrator on public.organizations for select to authenticated using (public.is_platform_administrator());
drop policy if exists organization_members_select_platform_administrator on public.organization_members;
create policy organization_members_select_platform_administrator on public.organization_members for select to authenticated using (public.is_platform_administrator());

revoke all on function public.is_platform_administrator() from public;
revoke all on function public.request_organization(text) from public;
revoke all on function public.approve_organization(uuid) from public;
revoke all on function public.suspend_organization(uuid) from public;
revoke all on function public.create_organization(text) from public;
grant execute on function public.is_platform_administrator() to authenticated;
grant execute on function public.request_organization(text) to authenticated;
grant execute on function public.approve_organization(uuid) to authenticated;
grant execute on function public.suspend_organization(uuid) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
