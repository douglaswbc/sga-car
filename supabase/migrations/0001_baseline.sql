-- Baseline do schema do SGA.
--
-- Gerado por `npm run db:baseline`, que concatena as migrations na ordem de nome.
-- Unificar só é seguro enquanto o banco não tem dado real: o histórico em
-- public.sga_schema_migrations perde a capacidade de dizer quando cada mudança entrou.
--
-- Origem: 55 migrations, de `202609120001_identity_and_organizations.sql` ate
-- `202609160015_zernio_whatsapp.sql`.
--
-- A ordem importa e não pode ser reordenada: tipos antes de colunas que os usam,
-- tabelas antes de policies e funções que as referenciam.
--
-- Alterações novas entram como migrations pequenas acrescentadas DEPOIS deste
-- arquivo, com a sequência global continuando. Não edite o baseline à mão.

-- ------------------------------------------------------------------------------
-- 202609120001_identity_and_organizations.sql — identity and organizations
-- ------------------------------------------------------------------------------

do $$
begin
  create type public.organization_role as enum ('owner', 'admin', 'finance', 'operations', 'support');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'operations',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_organization_idx
  on public.organization_members (user_id, organization_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 160), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_organization_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function public.create_organization(organization_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if char_length(btrim(coalesce(organization_name, ''))) not between 2 and 120 then
    raise exception 'organization name must contain between 2 and 120 characters';
  end if;

  insert into public.organizations (name)
  values (btrim(organization_name))
  returning * into created_organization;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_organization.id, auth.uid(), 'owner');

  return created_organization;
end;
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
for select to authenticated
using (public.is_organization_member(id));

drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner on public.organizations
for update to authenticated
using (public.is_organization_owner(id))
with check (public.is_organization_owner(id));

drop policy if exists organization_members_select_member on public.organization_members;
create policy organization_members_select_member on public.organization_members
for select to authenticated
using (public.is_organization_member(organization_id));

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.is_organization_owner(uuid) from public;
revoke all on function public.create_organization(text) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_owner(uuid) to authenticated;
grant execute on function public.create_organization(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609120002_audit_logs.sql — audit logs
-- ----------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 1 and 120),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_organization_created_at_idx
  on public.audit_logs (organization_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_member on public.audit_logs;
create policy audit_logs_select_member on public.audit_logs
for select to authenticated
using (public.is_organization_member(organization_id));

-- ----------------------------------------------------------------------------
-- 202609120003_platform_administration.sql — platform administration
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609120004_organization_requests.sql — organization requests
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609120005_active_organizations.sql — active organizations
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609120006_members_and_suspension.sql — members and suspension
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609130007_tenants.sql — tenants
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.tenant_status as enum ('active', 'inactive');
exception when duplicate_object then null;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  document_number text check (char_length(btrim(document_number)) between 3 and 32),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 32),
  status public.tenant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, document_number)
);

create table if not exists public.tenant_addresses (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  postal_code text check (char_length(postal_code) <= 16),
  street text check (char_length(street) <= 160),
  number text check (char_length(number) <= 32),
  complement text check (char_length(complement) <= 120),
  neighborhood text check (char_length(neighborhood) <= 120),
  city text check (char_length(city) <= 120),
  state text check (char_length(state) = 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_organization_name_idx on public.tenants (organization_id, full_name);
create index if not exists tenants_organization_status_idx on public.tenants (organization_id, status);

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at before update on public.tenants for each row execute function public.set_updated_at();
drop trigger if exists tenant_addresses_set_updated_at on public.tenant_addresses;
create trigger tenant_addresses_set_updated_at before update on public.tenant_addresses for each row execute function public.set_updated_at();

create or replace function public.is_active_organization_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id where m.organization_id = target_organization_id and m.user_id = auth.uid() and o.status = 'active'); $$;

create or replace function public.has_organization_role(target_organization_id uuid, allowed_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id where m.organization_id = target_organization_id and m.user_id = auth.uid() and m.role = any(allowed_roles) and o.status = 'active'); $$;

alter table public.tenants enable row level security;
alter table public.tenant_addresses enable row level security;
drop policy if exists tenants_select_active_member on public.tenants;
drop policy if exists tenants_write_operator on public.tenants;
drop policy if exists tenant_addresses_select_active_member on public.tenant_addresses;
drop policy if exists tenant_addresses_write_operator on public.tenant_addresses;
create policy tenants_select_active_member on public.tenants for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenants_write_operator on public.tenants for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));
create policy tenant_addresses_select_active_member on public.tenant_addresses for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenant_addresses_write_operator on public.tenant_addresses for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create or replace function public.list_tenants(target_organization_id uuid)
returns table (id uuid, full_name text, document_number text, email text, phone text, status public.tenant_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select t.id, t.full_name, t.document_number, t.email, t.phone, t.status, t.created_at from public.tenants t where t.organization_id = target_organization_id order by t.full_name;
end;
$$;

create or replace function public.create_tenant(target_organization_id uuid, tenant_full_name text, tenant_document_number text, tenant_email text, tenant_phone text)
returns public.tenants language plpgsql security definer set search_path = public
as $$
declare created_tenant public.tenants;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  insert into public.tenants (organization_id, full_name, document_number, email, phone)
  values (target_organization_id, btrim(tenant_full_name), nullif(btrim(tenant_document_number), ''), nullif(lower(btrim(tenant_email)), ''), nullif(btrim(tenant_phone), '')) returning * into created_tenant;
  return created_tenant;
end;
$$;

revoke all on function public.is_active_organization_member(uuid) from public;
revoke all on function public.has_organization_role(uuid, public.organization_role[]) from public;
revoke all on function public.list_tenants(uuid) from public;
revoke all on function public.create_tenant(uuid, text, text, text, text) from public;
grant execute on function public.is_active_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.organization_role[]) to authenticated;
grant execute on function public.list_tenants(uuid) to authenticated;
grant execute on function public.create_tenant(uuid, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609130008_tenant_addresses.sql — tenant addresses
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609130009_tenant_registration.sql — tenant registration
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609130010_tenant_phone_uniqueness.sql — tenant phone uniqueness
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609130011_vehicles.sql — vehicles
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.vehicle_status as enum ('available', 'rented', 'maintenance', 'inactive');
exception when duplicate_object then null;
end $$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plate text not null check (plate ~ '^[A-Z0-9]{7}$'),
  brand text not null check (char_length(btrim(brand)) between 2 and 60),
  model text not null check (char_length(btrim(model)) between 2 and 100),
  category text check (char_length(btrim(category)) between 2 and 60),
  model_year integer check (model_year between 1900 and 2100),
  color text check (char_length(btrim(color)) between 2 and 40),
  odometer_km integer not null default 0 check (odometer_km >= 0),
  status public.vehicle_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, plate)
);

create index vehicles_organization_status_idx on public.vehicles (organization_id, status);
create index vehicles_organization_model_idx on public.vehicles (organization_id, brand, model);
create trigger vehicles_set_updated_at before update on public.vehicles for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;
create policy vehicles_select_active_member on public.vehicles for select to authenticated using (public.is_active_organization_member(organization_id));
create policy vehicles_write_operator on public.vehicles for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create or replace function public.list_vehicles(target_organization_id uuid)
returns table (id uuid, plate text, brand text, model text, category text, model_year integer, color text, odometer_km integer, status public.vehicle_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select v.id, v.plate, v.brand, v.model, v.category, v.model_year, v.color, v.odometer_km, v.status, v.created_at from public.vehicles v where v.organization_id = target_organization_id order by v.brand, v.model, v.plate;
end;
$$;

create or replace function public.create_vehicle(target_organization_id uuid, vehicle_plate text, vehicle_brand text, vehicle_model text, vehicle_category text, vehicle_model_year integer, vehicle_color text, vehicle_odometer_km integer)
returns public.vehicles language plpgsql security definer set search_path = public
as $$
declare created_vehicle public.vehicles;
declare normalized_plate text := upper(regexp_replace(coalesce(vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if normalized_plate !~ '^[A-Z0-9]{7}$' then raise exception 'invalid plate'; end if;
  insert into public.vehicles (organization_id, plate, brand, model, category, model_year, color, odometer_km)
  values (target_organization_id, normalized_plate, btrim(vehicle_brand), btrim(vehicle_model), nullif(btrim(vehicle_category), ''), vehicle_model_year, nullif(btrim(vehicle_color), ''), coalesce(vehicle_odometer_km, 0))
  returning * into created_vehicle;
  return created_vehicle;
end;
$$;

revoke all on function public.list_vehicles(uuid) from public;
revoke all on function public.create_vehicle(uuid, text, text, text, text, integer, text, integer) from public;
grant execute on function public.list_vehicles(uuid) to authenticated;
grant execute on function public.create_vehicle(uuid, text, text, text, text, integer, text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609130012_vehicle_crud.sql — vehicle crud
-- ----------------------------------------------------------------------------

create or replace function public.update_vehicle(
  target_organization_id uuid, target_vehicle_id uuid, vehicle_plate text, vehicle_brand text, vehicle_model text,
  vehicle_category text, vehicle_model_year integer, vehicle_color text, vehicle_odometer_km integer, vehicle_status public.vehicle_status
)
returns public.vehicles language plpgsql security definer set search_path = public
as $$
declare updated_vehicle public.vehicles;
declare normalized_plate text := upper(regexp_replace(coalesce(vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if normalized_plate !~ '^[A-Z0-9]{7}$' then raise exception 'invalid plate'; end if;
  update public.vehicles
  set plate = normalized_plate, brand = btrim(vehicle_brand), model = btrim(vehicle_model), category = nullif(btrim(vehicle_category), ''),
      model_year = vehicle_model_year, color = nullif(btrim(vehicle_color), ''), odometer_km = coalesce(vehicle_odometer_km, 0), status = vehicle_status
  where id = target_vehicle_id and organization_id = target_organization_id
  returning * into updated_vehicle;
  if updated_vehicle.id is null then raise exception 'vehicle not found'; end if;
  return updated_vehicle;
end;
$$;

create or replace function public.delete_vehicle(target_organization_id uuid, target_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.vehicles where id = target_vehicle_id and organization_id = target_organization_id;
  if not found then raise exception 'vehicle not found'; end if;
end;
$$;

revoke all on function public.update_vehicle(uuid, uuid, text, text, text, text, integer, text, integer, public.vehicle_status) from public;
revoke all on function public.delete_vehicle(uuid, uuid) from public;
grant execute on function public.update_vehicle(uuid, uuid, text, text, text, text, integer, text, integer, public.vehicle_status) to authenticated;
grant execute on function public.delete_vehicle(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609130013_rental_contracts.sql — rental contracts
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.rental_contract_status as enum ('active', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table public.rental_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  starts_on date not null,
  expected_return_on date not null check (expected_return_on >= starts_on),
  actual_return_on date,
  daily_rate numeric(12,2) not null check (daily_rate > 0),
  status public.rental_contract_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (actual_return_on is null or actual_return_on >= starts_on)
);

create index rental_contracts_organization_status_idx on public.rental_contracts (organization_id, status);
create index rental_contracts_organization_tenant_idx on public.rental_contracts (organization_id, tenant_id);
create index rental_contracts_organization_vehicle_idx on public.rental_contracts (organization_id, vehicle_id);
create unique index rental_contracts_one_active_vehicle_idx on public.rental_contracts (vehicle_id) where status = 'active';
create trigger rental_contracts_set_updated_at before update on public.rental_contracts for each row execute function public.set_updated_at();

alter table public.rental_contracts enable row level security;
create policy rental_contracts_select_active_member on public.rental_contracts for select to authenticated using (public.is_active_organization_member(organization_id));
create policy rental_contracts_write_operator on public.rental_contracts for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create or replace function public.list_rental_contracts(target_organization_id uuid)
returns table (id uuid, tenant_id uuid, tenant_name text, vehicle_id uuid, vehicle_brand text, vehicle_model text, vehicle_plate text, starts_on date, expected_return_on date, daily_rate numeric, status public.rental_contract_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select c.id, t.id, t.full_name, v.id, v.brand, v.model, v.plate, c.starts_on, c.expected_return_on, c.daily_rate, c.status, c.created_at
  from public.rental_contracts c join public.tenants t on t.id = c.tenant_id join public.vehicles v on v.id = c.vehicle_id
  where c.organization_id = target_organization_id order by c.created_at desc;
end;
$$;

create or replace function public.create_rental_contract(target_organization_id uuid, target_tenant_id uuid, target_vehicle_id uuid, contract_starts_on date, contract_expected_return_on date, contract_daily_rate numeric)
returns public.rental_contracts language plpgsql security definer set search_path = public
as $$
declare created_contract public.rental_contracts;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if contract_expected_return_on < contract_starts_on or contract_daily_rate <= 0 then raise exception 'invalid contract terms'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id and status = 'active') then raise exception 'active tenant not found'; end if;
  update public.vehicles set status = 'rented' where id = target_vehicle_id and organization_id = target_organization_id and status = 'available';
  if not found then raise exception 'vehicle is not available'; end if;
  insert into public.rental_contracts (organization_id, tenant_id, vehicle_id, starts_on, expected_return_on, daily_rate)
  values (target_organization_id, target_tenant_id, target_vehicle_id, contract_starts_on, contract_expected_return_on, contract_daily_rate)
  returning * into created_contract;
  return created_contract;
end;
$$;

revoke all on function public.list_rental_contracts(uuid) from public;
revoke all on function public.create_rental_contract(uuid, uuid, uuid, date, date, numeric) from public;
grant execute on function public.list_rental_contracts(uuid) to authenticated;
grant execute on function public.create_rental_contract(uuid, uuid, uuid, date, date, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609130014_contract_crud_and_billing_schedule.sql — contract crud and billing schedule
-- ----------------------------------------------------------------------------

do $$
begin
  create type public.billing_frequency as enum ('daily', 'weekly', 'fortnightly', 'monthly', 'custom');
  create type public.billing_interval_unit as enum ('day', 'week', 'month');
exception when duplicate_object then null;
end $$;

alter table public.rental_contracts
  add column billing_frequency public.billing_frequency not null default 'monthly',
  add column billing_time time not null default '09:00',
  add column billing_custom_interval integer,
  add column billing_custom_unit public.billing_interval_unit,
  add constraint rental_contracts_custom_billing_check check (
    (billing_frequency = 'custom' and billing_custom_interval between 1 and 365 and billing_custom_unit is not null)
    or (billing_frequency <> 'custom' and billing_custom_interval is null and billing_custom_unit is null)
  );

drop function public.list_rental_contracts(uuid);
create function public.list_rental_contracts(target_organization_id uuid)
returns table (id uuid, tenant_id uuid, tenant_name text, vehicle_id uuid, vehicle_brand text, vehicle_model text, vehicle_plate text, starts_on date, expected_return_on date, actual_return_on date, daily_rate numeric, billing_frequency public.billing_frequency, billing_time time, billing_custom_interval integer, billing_custom_unit public.billing_interval_unit, status public.rental_contract_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select c.id, t.id, t.full_name, v.id, v.brand, v.model, v.plate, c.starts_on, c.expected_return_on, c.actual_return_on, c.daily_rate, c.billing_frequency, c.billing_time, c.billing_custom_interval, c.billing_custom_unit, c.status, c.created_at
  from public.rental_contracts c join public.tenants t on t.id = c.tenant_id join public.vehicles v on v.id = c.vehicle_id
  where c.organization_id = target_organization_id order by c.created_at desc;
end;
$$;

drop function public.create_rental_contract(uuid, uuid, uuid, date, date, numeric);
create function public.create_rental_contract(target_organization_id uuid, target_tenant_id uuid, target_vehicle_id uuid, contract_starts_on date, contract_expected_return_on date, contract_daily_rate numeric, contract_billing_frequency public.billing_frequency, contract_billing_time time, contract_billing_custom_interval integer, contract_billing_custom_unit public.billing_interval_unit)
returns public.rental_contracts language plpgsql security definer set search_path = public
as $$
declare created_contract public.rental_contracts;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if contract_expected_return_on < contract_starts_on or contract_daily_rate <= 0 then raise exception 'invalid contract terms'; end if;
  if (contract_billing_frequency = 'custom' and (contract_billing_custom_interval not between 1 and 365 or contract_billing_custom_unit is null)) or (contract_billing_frequency <> 'custom' and (contract_billing_custom_interval is not null or contract_billing_custom_unit is not null)) then raise exception 'invalid billing schedule'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id and status = 'active') then raise exception 'active tenant not found'; end if;
  update public.vehicles set status = 'rented' where id = target_vehicle_id and organization_id = target_organization_id and status = 'available';
  if not found then raise exception 'vehicle is not available'; end if;
  insert into public.rental_contracts (organization_id, tenant_id, vehicle_id, starts_on, expected_return_on, daily_rate, billing_frequency, billing_time, billing_custom_interval, billing_custom_unit)
  values (target_organization_id, target_tenant_id, target_vehicle_id, contract_starts_on, contract_expected_return_on, contract_daily_rate, contract_billing_frequency, contract_billing_time, contract_billing_custom_interval, contract_billing_custom_unit)
  returning * into created_contract;
  return created_contract;
end;
$$;

create function public.update_rental_contract(target_organization_id uuid, target_contract_id uuid, contract_expected_return_on date, contract_daily_rate numeric, contract_billing_frequency public.billing_frequency, contract_billing_time time, contract_billing_custom_interval integer, contract_billing_custom_unit public.billing_interval_unit, contract_status public.rental_contract_status, contract_actual_return_on date)
returns public.rental_contracts language plpgsql security definer set search_path = public
as $$
declare updated_contract public.rental_contracts;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if contract_daily_rate <= 0 then raise exception 'invalid daily rate'; end if;
  if (contract_billing_frequency = 'custom' and (contract_billing_custom_interval not between 1 and 365 or contract_billing_custom_unit is null)) or (contract_billing_frequency <> 'custom' and (contract_billing_custom_interval is not null or contract_billing_custom_unit is not null)) then raise exception 'invalid billing schedule'; end if;
  update public.rental_contracts set expected_return_on = contract_expected_return_on, daily_rate = contract_daily_rate, billing_frequency = contract_billing_frequency, billing_time = contract_billing_time, billing_custom_interval = contract_billing_custom_interval, billing_custom_unit = contract_billing_custom_unit, status = contract_status, actual_return_on = case when contract_status = 'active' then null else contract_actual_return_on end
  where id = target_contract_id and organization_id = target_organization_id and contract_expected_return_on >= starts_on
  returning * into updated_contract;
  if updated_contract.id is null then raise exception 'contract not found or invalid dates'; end if;
  if updated_contract.status <> 'active' then update public.vehicles set status = 'available' where id = updated_contract.vehicle_id and organization_id = target_organization_id and status = 'rented'; end if;
  return updated_contract;
end;
$$;

create function public.delete_rental_contract(target_organization_id uuid, target_contract_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id and status <> 'active';
  if not found then raise exception 'only completed or cancelled contracts can be deleted'; end if;
end;
$$;

revoke all on function public.list_rental_contracts(uuid) from public;
revoke all on function public.create_rental_contract(uuid, uuid, uuid, date, date, numeric, public.billing_frequency, time, integer, public.billing_interval_unit) from public;
revoke all on function public.update_rental_contract(uuid, uuid, date, numeric, public.billing_frequency, time, integer, public.billing_interval_unit, public.rental_contract_status, date) from public;
revoke all on function public.delete_rental_contract(uuid, uuid) from public;
grant execute on function public.list_rental_contracts(uuid) to authenticated;
grant execute on function public.create_rental_contract(uuid, uuid, uuid, date, date, numeric, public.billing_frequency, time, integer, public.billing_interval_unit) to authenticated;
grant execute on function public.update_rental_contract(uuid, uuid, date, numeric, public.billing_frequency, time, integer, public.billing_interval_unit, public.rental_contract_status, date) to authenticated;
grant execute on function public.delete_rental_contract(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609130015_refresh_contract_rpc_schema.sql — refresh contract rpc schema
-- ----------------------------------------------------------------------------

-- Ensures Supabase PostgREST reloads the updated RPC return shape.
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 202609140016_invoices_and_payments.sql — invoices and payments
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.invoice_status as enum ('pending', 'paid', 'overdue', 'cancelled', 'reversed');
  create type public.payment_method as enum ('cash', 'pix', 'bank_transfer', 'credit_card', 'debit_card', 'other');
exception when duplicate_object then null;
end $$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid references public.rental_contracts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  billing_period_starts_on date not null,
  billing_period_ends_on date not null check (billing_period_ends_on >= billing_period_starts_on),
  due_on date not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  additional_amount numeric(12,2) not null default 0 check (additional_amount >= 0),
  amount_due numeric(12,2) not null check (amount_due >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  status public.invoice_status not null default 'pending',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= amount_due)
);
create unique index invoices_contract_period_unique on public.invoices (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null;
create index invoices_organization_status_due_idx on public.invoices (organization_id, status, due_on);
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null,
  receipt_url text,
  note text,
  created_at timestamptz not null default now()
);
create index payments_organization_invoice_idx on public.payments (organization_id, invoice_id, paid_on desc);

alter table public.invoices enable row level security;
alter table public.payments enable row level security;
create policy invoices_select_member on public.invoices for select to authenticated using (public.is_active_organization_member(organization_id));
create policy invoices_write_finance on public.invoices for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));
create policy payments_select_member on public.payments for select to authenticated using (public.is_active_organization_member(organization_id));
create policy payments_write_finance on public.payments for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));

create function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; period_start date; next_start date; period_end date; count_created integer := 0; interval_value integer; interval_unit public.billing_interval_unit;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  for c in select * from public.rental_contracts where organization_id = target_organization_id and status = 'active' loop
    interval_value := case c.billing_frequency when 'daily' then 1 when 'weekly' then 1 when 'fortnightly' then 2 when 'monthly' then 1 else c.billing_custom_interval end;
    interval_unit := case c.billing_frequency when 'daily' then 'day'::public.billing_interval_unit when 'weekly' then 'week'::public.billing_interval_unit when 'fortnightly' then 'week'::public.billing_interval_unit when 'monthly' then 'month'::public.billing_interval_unit else c.billing_custom_unit end;
    period_start := c.starts_on;
    while period_start <= least(generate_until, c.expected_return_on) loop
      next_start := case interval_unit when 'day' then period_start + interval_value when 'week' then period_start + (interval_value * 7) else (period_start + make_interval(months => interval_value))::date end;
      period_end := least(next_start - 1, c.expected_return_on);
      insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.id, c.tenant_id, period_start, period_end, period_end, round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2), round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2), 'Cobrança de locação')
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing;
      if found then count_created := count_created + 1; end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return count_created;
end;
$$;

create function public.create_manual_invoice(target_organization_id uuid, target_tenant_id uuid, target_contract_id uuid, invoice_due_on date, invoice_amount numeric, invoice_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare created_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if invoice_amount <= 0 or not exists(select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'invalid invoice'; end if;
  if target_contract_id is not null and not exists(select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id and tenant_id = target_tenant_id) then raise exception 'invalid contract'; end if;
  insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, target_contract_id, target_tenant_id, invoice_due_on, invoice_due_on, invoice_due_on, invoice_amount, invoice_amount, nullif(trim(invoice_description), '')) returning * into created_invoice;
  return created_invoice;
end;
$$;

create function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note) values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), '')) returning * into created_payment;
  update public.invoices set amount_paid = new_paid, status = case when new_paid = amount_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end where id = target_invoice_id;
  return created_payment;
end;
$$;

create function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return query select i.id, i.contract_id, i.tenant_id, t.full_name, i.due_on, i.amount_due, i.amount_paid, i.status, i.description, i.created_at from public.invoices i join public.tenants t on t.id = i.tenant_id where i.organization_id = target_organization_id order by i.due_on asc, i.created_at desc;
end;
$$;

revoke all on function public.generate_contract_invoices(uuid, date), public.create_manual_invoice(uuid, uuid, uuid, date, numeric, text), public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text), public.list_invoices(uuid) from public;
grant execute on function public.generate_contract_invoices(uuid, date), public.create_manual_invoice(uuid, uuid, uuid, date, numeric, text), public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text), public.list_invoices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140017_fix_list_invoices_status_ambiguity.sql — fix list invoices status ambiguity
-- ----------------------------------------------------------------------------

create or replace function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices as invoice
  set status = 'overdue'
  where invoice.organization_id = target_organization_id
    and invoice.status = 'pending'
    and invoice.due_on < current_date;
  return query
  select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name, invoice.due_on, invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description, invoice.created_at
  from public.invoices as invoice
  join public.tenants as tenant on tenant.id = invoice.tenant_id
  where invoice.organization_id = target_organization_id
  order by invoice.due_on asc, invoice.created_at desc;
end;
$$;

revoke all on function public.list_invoices(uuid) from public;
grant execute on function public.list_invoices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140018_fix_payment_invoice_status_cast.sql — fix payment invoice status cast
-- ----------------------------------------------------------------------------

create or replace function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note)
  values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), ''))
  returning * into created_payment;
  update public.invoices
  set amount_paid = new_paid,
      status = (case when new_paid = amount_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end)::public.invoice_status
  where id = target_invoice_id;
  return created_payment;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text) from public;
grant execute on function public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140019_invoice_adjustments_and_renegotiation.sql — invoice adjustments and renegotiation
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.invoice_adjustment_type as enum ('discount', 'additional', 'fine', 'interest', 'renegotiation');
exception when duplicate_object then null;
end $$;

alter table public.invoices
  add column fine_amount numeric(12,2) not null default 0 check (fine_amount >= 0),
  add column interest_amount numeric(12,2) not null default 0 check (interest_amount >= 0);

create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  type public.invoice_adjustment_type not null,
  amount numeric(12,2) not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index invoice_adjustments_invoice_idx on public.invoice_adjustments (invoice_id, created_at desc);
alter table public.invoice_adjustments enable row level security;
create policy invoice_adjustments_select_member on public.invoice_adjustments for select to authenticated using (public.is_active_organization_member(organization_id));
create policy invoice_adjustments_write_finance on public.invoice_adjustments for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));

create function public.apply_invoice_adjustment(target_organization_id uuid, target_invoice_id uuid, adjustment_type public.invoice_adjustment_type, adjustment_amount numeric, adjustment_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; updated_invoice public.invoices; new_discount numeric; new_additional numeric; new_fine numeric; new_interest numeric; new_due numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if adjustment_type = 'renegotiation' or adjustment_amount <= 0 or nullif(trim(adjustment_description), '') is null then raise exception 'invalid adjustment'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') then raise exception 'invoice is not adjustable'; end if;
  new_discount := target_invoice.discount_amount + case when adjustment_type = 'discount' then adjustment_amount else 0 end;
  new_additional := target_invoice.additional_amount + case when adjustment_type = 'additional' then adjustment_amount else 0 end;
  new_fine := target_invoice.fine_amount + case when adjustment_type = 'fine' then adjustment_amount else 0 end;
  new_interest := target_invoice.interest_amount + case when adjustment_type = 'interest' then adjustment_amount else 0 end;
  new_due := target_invoice.subtotal - new_discount + new_additional + new_fine + new_interest;
  if new_due < target_invoice.amount_paid then raise exception 'adjustment cannot reduce the invoice below paid amount'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description) values (target_organization_id, target_invoice_id, adjustment_type, adjustment_amount, trim(adjustment_description));
  update public.invoices set discount_amount = new_discount, additional_amount = new_additional, fine_amount = new_fine, interest_amount = new_interest, amount_due = new_due, status = case when amount_paid = new_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end::public.invoice_status where id = target_invoice_id returning * into updated_invoice;
  return updated_invoice;
end;
$$;

create function public.renegotiate_invoice(target_organization_id uuid, target_invoice_id uuid, renegotiated_due_on date, renegotiated_amount numeric, renegotiation_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; updated_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if renegotiated_amount <= 0 or nullif(trim(renegotiation_description), '') is null then raise exception 'invalid renegotiation'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or renegotiated_amount < target_invoice.amount_paid then raise exception 'invoice is not renegotiable'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description) values (target_organization_id, target_invoice_id, 'renegotiation', renegotiated_amount - target_invoice.amount_due, trim(renegotiation_description));
  update public.invoices set subtotal = renegotiated_amount, discount_amount = 0, additional_amount = 0, fine_amount = 0, interest_amount = 0, amount_due = renegotiated_amount, due_on = renegotiated_due_on, status = case when amount_paid = renegotiated_amount then 'paid' else 'pending' end::public.invoice_status where id = target_invoice_id returning * into updated_invoice;
  return updated_invoice;
end;
$$;

drop function public.list_invoices(uuid);
create function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, subtotal numeric, discount_amount numeric, additional_amount numeric, fine_amount numeric, interest_amount numeric, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices as invoice set status = 'overdue' where invoice.organization_id = target_organization_id and invoice.status = 'pending' and invoice.due_on < current_date;
  return query select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name, invoice.due_on, invoice.subtotal, invoice.discount_amount, invoice.additional_amount, invoice.fine_amount, invoice.interest_amount, invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description, invoice.created_at from public.invoices as invoice join public.tenants as tenant on tenant.id = invoice.tenant_id where invoice.organization_id = target_organization_id order by invoice.due_on asc, invoice.created_at desc;
end;
$$;

revoke all on function public.apply_invoice_adjustment(uuid, uuid, public.invoice_adjustment_type, numeric, text), public.renegotiate_invoice(uuid, uuid, date, numeric, text), public.list_invoices(uuid) from public;
grant execute on function public.apply_invoice_adjustment(uuid, uuid, public.invoice_adjustment_type, numeric, text), public.renegotiate_invoice(uuid, uuid, date, numeric, text), public.list_invoices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140020_contract_inspections.sql — contract inspections
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.contract_inspection_type as enum ('pickup', 'return');
exception when duplicate_object then null;
end $$;

create table public.contract_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  type public.contract_inspection_type not null,
  inspected_on date not null default current_date,
  odometer_km integer not null check (odometer_km >= 0),
  fuel_level smallint not null check (fuel_level between 0 and 100),
  accessories text[] not null default '{}',
  notes text,
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, type)
);
create trigger contract_inspections_set_updated_at before update on public.contract_inspections for each row execute function public.set_updated_at();

create table public.contract_inspection_damages (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.contract_inspections(id) on delete cascade,
  description text not null,
  estimated_cost numeric(12,2) not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default now()
);
create index contract_inspections_contract_idx on public.contract_inspections (contract_id, type);
create index contract_inspection_damages_inspection_idx on public.contract_inspection_damages (inspection_id);

alter table public.contract_inspections enable row level security;
alter table public.contract_inspection_damages enable row level security;
create policy contract_inspections_select_member on public.contract_inspections for select to authenticated using (public.is_active_organization_member(organization_id));
create policy contract_inspections_write_operator on public.contract_inspections for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));
create policy contract_inspection_damages_select_member on public.contract_inspection_damages for select to authenticated using (exists (select 1 from public.contract_inspections inspection where inspection.id = inspection_id and public.is_active_organization_member(inspection.organization_id)));
create policy contract_inspection_damages_write_operator on public.contract_inspection_damages for all to authenticated using (exists (select 1 from public.contract_inspections inspection where inspection.id = inspection_id and public.has_organization_role(inspection.organization_id, array['owner', 'admin', 'operations']::public.organization_role[]))) with check (exists (select 1 from public.contract_inspections inspection where inspection.id = inspection_id and public.has_organization_role(inspection.organization_id, array['owner', 'admin', 'operations']::public.organization_role[])));

create function public.upsert_contract_inspection(target_organization_id uuid, target_contract_id uuid, inspection_type public.contract_inspection_type, inspection_date date, inspection_odometer_km integer, inspection_fuel_level smallint, inspection_accessories text[], inspection_notes text, inspection_photo_urls text[], inspection_damages jsonb)
returns public.contract_inspections language plpgsql security definer set search_path = public as $$
declare saved_inspection public.contract_inspections; damage jsonb;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id) then raise exception 'contract not found'; end if;
  if inspection_type = 'return' and not exists (select 1 from public.contract_inspections where contract_id = target_contract_id and type = 'pickup') then raise exception 'pickup inspection is required before return'; end if;
  insert into public.contract_inspections (organization_id, contract_id, type, inspected_on, odometer_km, fuel_level, accessories, notes, photo_urls)
  values (target_organization_id, target_contract_id, inspection_type, inspection_date, inspection_odometer_km, inspection_fuel_level, coalesce(inspection_accessories, '{}'), nullif(trim(inspection_notes), ''), coalesce(inspection_photo_urls, '{}'))
  on conflict (contract_id, type) do update set inspected_on = excluded.inspected_on, odometer_km = excluded.odometer_km, fuel_level = excluded.fuel_level, accessories = excluded.accessories, notes = excluded.notes, photo_urls = excluded.photo_urls
  returning * into saved_inspection;
  delete from public.contract_inspection_damages where inspection_id = saved_inspection.id;
  for damage in select * from jsonb_array_elements(coalesce(inspection_damages, '[]'::jsonb)) loop
    if nullif(trim(damage->>'description'), '') is not null then insert into public.contract_inspection_damages (inspection_id, description, estimated_cost) values (saved_inspection.id, trim(damage->>'description'), coalesce((damage->>'estimatedCost')::numeric, 0)); end if;
  end loop;
  if inspection_type = 'return' then update public.vehicles set odometer_km = greatest(odometer_km, inspection_odometer_km) where id = (select vehicle_id from public.rental_contracts where id = target_contract_id) and organization_id = target_organization_id; end if;
  return saved_inspection;
end;
$$;

create function public.list_contract_inspections(target_organization_id uuid, target_contract_id uuid)
returns table (id uuid, type public.contract_inspection_type, inspected_on date, odometer_km integer, fuel_level smallint, accessories text[], notes text, photo_urls text[], damage_count bigint, damage_cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select inspection.id, inspection.type, inspection.inspected_on, inspection.odometer_km, inspection.fuel_level, inspection.accessories, inspection.notes, inspection.photo_urls, count(damage.id), coalesce(sum(damage.estimated_cost), 0) from public.contract_inspections inspection left join public.contract_inspection_damages damage on damage.inspection_id = inspection.id where inspection.organization_id = target_organization_id and inspection.contract_id = target_contract_id group by inspection.id order by inspection.type;
end;
$$;

revoke all on function public.upsert_contract_inspection(uuid, uuid, public.contract_inspection_type, date, integer, smallint, text[], text, text[], jsonb), public.list_contract_inspections(uuid, uuid) from public;
grant execute on function public.upsert_contract_inspection(uuid, uuid, public.contract_inspection_type, date, integer, smallint, text[], text, text[], jsonb), public.list_contract_inspections(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140021_vehicle_maintenance.sql — vehicle maintenance
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.maintenance_type as enum ('preventive', 'corrective');
  create type public.maintenance_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table public.vehicle_odometer_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  recorded_on date not null default current_date,
  odometer_km integer not null check (odometer_km >= 0),
  note text,
  created_at timestamptz not null default now()
);
create table public.vehicle_maintenances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  type public.maintenance_type not null,
  status public.maintenance_status not null default 'scheduled',
  title text not null,
  scheduled_on date not null,
  completed_on date,
  scheduled_odometer_km integer,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_on is null or completed_on >= scheduled_on)
);
create trigger vehicle_maintenances_set_updated_at before update on public.vehicle_maintenances for each row execute function public.set_updated_at();
create index vehicle_odometer_entries_vehicle_idx on public.vehicle_odometer_entries(vehicle_id, recorded_on desc);
create index vehicle_maintenances_vehicle_idx on public.vehicle_maintenances(vehicle_id, scheduled_on desc);
alter table public.vehicle_odometer_entries enable row level security;
alter table public.vehicle_maintenances enable row level security;
create policy vehicle_odometer_entries_member on public.vehicle_odometer_entries for select to authenticated using (public.is_active_organization_member(organization_id));
create policy vehicle_odometer_entries_operator on public.vehicle_odometer_entries for all to authenticated using (public.has_organization_role(organization_id, array['owner','admin','operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner','admin','operations']::public.organization_role[]));
create policy vehicle_maintenances_member on public.vehicle_maintenances for select to authenticated using (public.is_active_organization_member(organization_id));
create policy vehicle_maintenances_operator on public.vehicle_maintenances for all to authenticated using (public.has_organization_role(organization_id, array['owner','admin','operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner','admin','operations']::public.organization_role[]));

create function public.record_vehicle_odometer(target_organization_id uuid, target_vehicle_id uuid, entry_date date, entry_odometer_km integer, entry_note text)
returns public.vehicle_odometer_entries language plpgsql security definer set search_path=public as $$
declare entry public.vehicle_odometer_entries;
begin
 if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
 update public.vehicles set odometer_km=entry_odometer_km where id=target_vehicle_id and organization_id=target_organization_id and odometer_km <= entry_odometer_km;
 if not found then raise exception 'odometer cannot decrease'; end if;
 insert into public.vehicle_odometer_entries(organization_id,vehicle_id,recorded_on,odometer_km,note) values(target_organization_id,target_vehicle_id,entry_date,entry_odometer_km,nullif(trim(entry_note),'')) returning * into entry;
 return entry;
end; $$;
revoke all on function public.record_vehicle_odometer(uuid,uuid,date,integer,text) from public;
grant execute on function public.record_vehicle_odometer(uuid,uuid,date,integer,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140022_vehicle_maintenance_rpcs.sql — vehicle maintenance rpcs
-- ----------------------------------------------------------------------------

create function public.create_vehicle_maintenance(target_organization_id uuid, target_vehicle_id uuid, maintenance_type public.maintenance_type, maintenance_title text, maintenance_scheduled_on date, maintenance_scheduled_odometer_km integer, maintenance_cost numeric, maintenance_notes text)
returns public.vehicle_maintenances language plpgsql security definer set search_path=public as $$
declare maintenance public.vehicle_maintenances;
begin
 if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
 if not exists(select 1 from public.vehicles where id=target_vehicle_id and organization_id=target_organization_id) then raise exception 'vehicle not found'; end if;
 insert into public.vehicle_maintenances(organization_id,vehicle_id,type,title,scheduled_on,scheduled_odometer_km,cost,notes) values(target_organization_id,target_vehicle_id,maintenance_type,trim(maintenance_title),maintenance_scheduled_on,maintenance_scheduled_odometer_km,maintenance_cost,nullif(trim(maintenance_notes),'')) returning * into maintenance;
 return maintenance;
end; $$;
create function public.list_vehicle_maintenance(target_organization_id uuid, target_vehicle_id uuid)
returns table(id uuid,type public.maintenance_type,status public.maintenance_status,title text,scheduled_on date,completed_on date,scheduled_odometer_km integer,cost numeric,notes text) language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
 return query select id,type,status,title,scheduled_on,completed_on,scheduled_odometer_km,cost,notes from public.vehicle_maintenances where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by scheduled_on desc;
end; $$;
revoke all on function public.create_vehicle_maintenance(uuid,uuid,public.maintenance_type,text,date,integer,numeric,text),public.list_vehicle_maintenance(uuid,uuid) from public;
grant execute on function public.create_vehicle_maintenance(uuid,uuid,public.maintenance_type,text,date,integer,numeric,text),public.list_vehicle_maintenance(uuid,uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140023_list_vehicle_odometer.sql — list vehicle odometer
-- ----------------------------------------------------------------------------

create function public.list_vehicle_odometer_entries(target_organization_id uuid, target_vehicle_id uuid)
returns table (id uuid, recorded_on date, odometer_km integer, note text, created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
 return query select id,recorded_on,odometer_km,note,created_at from public.vehicle_odometer_entries where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by recorded_on desc,created_at desc;
end; $$;
revoke all on function public.list_vehicle_odometer_entries(uuid,uuid) from public;
grant execute on function public.list_vehicle_odometer_entries(uuid,uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140024_vehicle_documents_and_maintenance_completion.sql — vehicle documents and maintenance completion
-- ----------------------------------------------------------------------------

alter table public.vehicle_maintenances add column completed_odometer_km integer;

create table public.vehicle_documents (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 vehicle_id uuid not null references public.vehicles(id) on delete cascade,
 type text not null check (type in ('crlv','insurance','inspection','other')),
 name text not null,
 url text not null,
 expires_on date,
 created_at timestamptz not null default now()
);
create table public.vehicle_accessories (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 vehicle_id uuid not null references public.vehicles(id) on delete cascade,
 name text not null,
 created_at timestamptz not null default now(),
 unique(vehicle_id,name)
);
alter table public.vehicle_documents enable row level security;
alter table public.vehicle_accessories enable row level security;
create policy vehicle_documents_member on public.vehicle_documents for select to authenticated using(public.is_active_organization_member(organization_id));
create policy vehicle_documents_operator on public.vehicle_documents for all to authenticated using(public.has_organization_role(organization_id,array['owner','admin','operations']::public.organization_role[])) with check(public.has_organization_role(organization_id,array['owner','admin','operations']::public.organization_role[]));
create policy vehicle_accessories_member on public.vehicle_accessories for select to authenticated using(public.is_active_organization_member(organization_id));
create policy vehicle_accessories_operator on public.vehicle_accessories for all to authenticated using(public.has_organization_role(organization_id,array['owner','admin','operations']::public.organization_role[])) with check(public.has_organization_role(organization_id,array['owner','admin','operations']::public.organization_role[]));

-- ----------------------------------------------------------------------------
-- 202609140025_complete_vehicle_maintenance.sql — complete vehicle maintenance
-- ----------------------------------------------------------------------------

create function public.update_vehicle_maintenance_status(target_organization_id uuid, target_maintenance_id uuid, target_status public.maintenance_status, completion_date date, completion_odometer_km integer)
returns public.vehicle_maintenances language plpgsql security definer set search_path=public as $$
declare maintenance public.vehicle_maintenances;
begin
 if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
 update public.vehicle_maintenances set status=target_status,completed_on=case when target_status='completed' then completion_date else null end,completed_odometer_km=case when target_status='completed' then completion_odometer_km else null end where id=target_maintenance_id and organization_id=target_organization_id and status in ('scheduled','in_progress') returning * into maintenance;
 if maintenance.id is null then raise exception 'maintenance not found or cannot transition'; end if;
 if target_status='completed' then update public.vehicles set odometer_km=greatest(odometer_km,completion_odometer_km) where id=maintenance.vehicle_id and organization_id=target_organization_id; end if;
 return maintenance;
end; $$;
revoke all on function public.update_vehicle_maintenance_status(uuid,uuid,public.maintenance_status,date,integer) from public;
grant execute on function public.update_vehicle_maintenance_status(uuid,uuid,public.maintenance_status,date,integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140026_list_vehicle_assets.sql — list vehicle assets
-- ----------------------------------------------------------------------------

create function public.list_vehicle_documents(target_organization_id uuid,target_vehicle_id uuid) returns table(id uuid,type text,name text,url text,expires_on date) language sql stable security definer set search_path=public as $$ select id,type,name,url,expires_on from public.vehicle_documents where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by expires_on nulls last $$;
create function public.list_vehicle_accessories(target_organization_id uuid,target_vehicle_id uuid) returns table(id uuid,name text) language sql stable security definer set search_path=public as $$ select id,name from public.vehicle_accessories where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by name $$;
revoke all on function public.list_vehicle_documents(uuid,uuid),public.list_vehicle_accessories(uuid,uuid) from public;
grant execute on function public.list_vehicle_documents(uuid,uuid),public.list_vehicle_accessories(uuid,uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140027_create_vehicle_assets.sql — create vehicle assets
-- ----------------------------------------------------------------------------

create function public.add_vehicle_document(target_organization_id uuid,target_vehicle_id uuid,document_type text,document_name text,document_url text,document_expires_on date) returns public.vehicle_documents language plpgsql security definer set search_path=public as $$ declare d public.vehicle_documents; begin if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if; insert into public.vehicle_documents(organization_id,vehicle_id,type,name,url,expires_on) values(target_organization_id,target_vehicle_id,document_type,trim(document_name),trim(document_url),document_expires_on) returning * into d; return d; end $$;
create function public.add_vehicle_accessory(target_organization_id uuid,target_vehicle_id uuid,accessory_name text) returns public.vehicle_accessories language plpgsql security definer set search_path=public as $$ declare a public.vehicle_accessories; begin if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if; insert into public.vehicle_accessories(organization_id,vehicle_id,name) values(target_organization_id,target_vehicle_id,trim(accessory_name)) returning * into a; return a; end $$;
revoke all on function public.add_vehicle_document(uuid,uuid,text,text,text,date),public.add_vehicle_accessory(uuid,uuid,text) from public;
grant execute on function public.add_vehicle_document(uuid,uuid,text,text,text,date),public.add_vehicle_accessory(uuid,uuid,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140028_tenant_crud.sql — tenant crud
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 202609140029_tenant_documents.sql — tenant documents
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.tenant_document_type as enum ('cnh', 'proof_of_address', 'other');
exception when duplicate_object then null;
end $$;

create table public.tenant_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.tenant_document_type not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  url text,
  identifier text,
  category text,
  expires_on date,
  created_at timestamptz not null default now()
);
create index tenant_documents_tenant_idx on public.tenant_documents (organization_id, tenant_id, created_at desc);
create unique index tenant_documents_single_cnh_idx on public.tenant_documents (organization_id, tenant_id) where type = 'cnh';

alter table public.tenant_documents enable row level security;
create policy tenant_documents_select_member on public.tenant_documents for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenant_documents_write_operator on public.tenant_documents for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create function public.list_tenant_documents(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, type public.tenant_document_type, name text, url text, identifier text, category text, expires_on date, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select d.id, d.type, d.name, d.url, d.identifier, d.category, d.expires_on, d.created_at
  from public.tenant_documents d
  where d.organization_id = target_organization_id and d.tenant_id = target_tenant_id
  order by d.created_at desc;
end;
$$;

create function public.add_tenant_document(
  target_organization_id uuid, target_tenant_id uuid, document_type public.tenant_document_type,
  document_name text, document_url text, document_identifier text, document_category text, document_expires_on date
)
returns public.tenant_documents language plpgsql security definer set search_path = public
as $$
declare created_document public.tenant_documents;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  if char_length(btrim(coalesce(document_name, ''))) < 1 then raise exception 'invalid document name'; end if;
  insert into public.tenant_documents (organization_id, tenant_id, type, name, url, identifier, category, expires_on)
  values (target_organization_id, target_tenant_id, document_type, btrim(document_name), nullif(btrim(document_url), ''), nullif(btrim(document_identifier), ''), nullif(btrim(document_category), ''), document_expires_on)
  returning * into created_document;
  return created_document;
end;
$$;

create function public.delete_tenant_document(target_organization_id uuid, target_tenant_id uuid, target_document_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.tenant_documents where id = target_document_id and tenant_id = target_tenant_id and organization_id = target_organization_id;
  if not found then raise exception 'document not found'; end if;
end;
$$;

revoke all on function public.list_tenant_documents(uuid, uuid) from public;
revoke all on function public.add_tenant_document(uuid, uuid, public.tenant_document_type, text, text, text, text, date) from public;
revoke all on function public.delete_tenant_document(uuid, uuid, uuid) from public;
grant execute on function public.list_tenant_documents(uuid, uuid) to authenticated;
grant execute on function public.add_tenant_document(uuid, uuid, public.tenant_document_type, text, text, text, text, date) to authenticated;
grant execute on function public.delete_tenant_document(uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140030_tenant_eligibility_history.sql — tenant eligibility history
-- ----------------------------------------------------------------------------

drop function if exists public.list_tenants(uuid);

create function public.list_tenants(target_organization_id uuid)
returns table (id uuid, full_name text, document_number text, email text, phone text, status public.tenant_status, is_eligible boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select t.id, t.full_name, t.document_number, t.email, t.phone, t.status,
    (
      t.status = 'active'
      and exists (
        select 1 from public.tenant_documents d
        where d.tenant_id = t.id and d.organization_id = t.organization_id
          and d.type = 'cnh' and d.expires_on is not null and d.expires_on >= current_date
      )
    ) as is_eligible,
    t.created_at
  from public.tenants t
  where t.organization_id = target_organization_id
  order by t.full_name;
end;
$$;

create function public.list_tenant_payments(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, invoice_id uuid, paid_on date, amount numeric, method public.payment_method, receipt_url text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select p.id, p.invoice_id, p.paid_on, p.amount, p.method, p.receipt_url, p.note, p.created_at
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where p.organization_id = target_organization_id and i.tenant_id = target_tenant_id
  order by p.paid_on desc, p.created_at desc;
end;
$$;

revoke all on function public.list_tenants(uuid) from public;
revoke all on function public.list_tenant_payments(uuid, uuid) from public;
grant execute on function public.list_tenants(uuid) to authenticated;
grant execute on function public.list_tenant_payments(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140031_message_templates.sql — message templates
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.message_channel as enum ('email', 'whatsapp');
  create type public.message_event as enum ('member_invite', 'invoice_created', 'payment_receipt', 'invoice_due_soon', 'invoice_overdue');
exception when duplicate_object then null;
end $$;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  channel public.message_channel not null,
  event public.message_event not null,
  subject text,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  provider_template_name text,
  provider_template_language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, channel, event)
);

alter table public.message_templates enable row level security;
drop policy if exists message_templates_select_member on public.message_templates;
drop policy if exists message_templates_write_manager on public.message_templates;
create policy message_templates_select_member on public.message_templates for select to authenticated
  using (organization_id is null or public.is_active_organization_member(organization_id));
create policy message_templates_write_manager on public.message_templates for all to authenticated
  using (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
  with check (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create trigger message_templates_set_updated_at before update on public.message_templates for each row execute function public.set_updated_at();

insert into public.message_templates (organization_id, channel, event, subject, body) values
  (null, 'email', 'member_invite', 'Você foi adicionado à organização {{organization_name}}', 'Olá {{member_name}}, você foi adicionado à equipe de {{organization_name}} no SGA.'),
  (null, 'email', 'invoice_created', 'Nova cobrança — vencimento {{due_on}}', 'Olá {{tenant_name}}, foi gerada uma cobrança de {{amount}} com vencimento em {{due_on}}.'),
  (null, 'email', 'payment_receipt', 'Recibo de pagamento', 'Olá {{tenant_name}}, recebemos {{amount}} em {{paid_on}}. Obrigado!'),
  (null, 'email', 'invoice_due_soon', 'Lembrete de vencimento', 'Olá {{tenant_name}}, sua cobrança de {{amount}} vence em {{due_on}}.'),
  (null, 'email', 'invoice_overdue', 'Cobrança vencida', 'Olá {{tenant_name}}, identificamos a cobrança de {{amount}} vencida em {{due_on}}.'),
  (null, 'whatsapp', 'member_invite', null, 'SGA: {{member_name}}, você foi adicionado à equipe de {{organization_name}}.'),
  (null, 'whatsapp', 'invoice_created', null, 'SGA: {{tenant_name}}, nova cobrança de {{amount}} com vencimento em {{due_on}}.'),
  (null, 'whatsapp', 'payment_receipt', null, 'SGA: recebemos {{amount}} referente a {{tenant_name}} em {{paid_on}}.'),
  (null, 'whatsapp', 'invoice_due_soon', null, 'SGA: {{tenant_name}}, sua cobrança de {{amount}} vence em {{due_on}}.'),
  (null, 'whatsapp', 'invoice_overdue', null, 'SGA: {{tenant_name}}, a cobrança de {{amount}} venceu em {{due_on}}.')
on conflict do nothing;

create or replace function public.list_message_templates(target_organization_id uuid)
returns table (channel public.message_channel, event public.message_event, subject text, body text, provider_template_name text, provider_template_language text, is_custom boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select distinct on (template.channel, template.event)
    template.channel, template.event, template.subject, template.body, template.provider_template_name,
    template.provider_template_language, (template.organization_id is not null) as is_custom
  from public.message_templates template
  where template.organization_id is null or template.organization_id = target_organization_id
  order by template.channel, template.event, template.organization_id nulls last;
end;
$$;

create or replace function public.upsert_message_template(
  target_organization_id uuid, template_channel public.message_channel, template_event public.message_event,
  template_subject text, template_body text, template_provider_name text, template_provider_language text
)
returns public.message_templates language plpgsql security definer set search_path = public
as $$
declare saved_template public.message_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if char_length(btrim(coalesce(template_body, ''))) < 1 then raise exception 'invalid template body'; end if;
  insert into public.message_templates (organization_id, channel, event, subject, body, provider_template_name, provider_template_language)
  values (target_organization_id, template_channel, template_event, nullif(btrim(template_subject), ''), btrim(template_body), nullif(btrim(template_provider_name), ''), nullif(btrim(template_provider_language), ''))
  on conflict (organization_id, channel, event) do update
    set subject = excluded.subject, body = excluded.body, provider_template_name = excluded.provider_template_name, provider_template_language = excluded.provider_template_language
  returning * into saved_template;
  return saved_template;
end;
$$;

revoke all on function public.list_message_templates(uuid) from public;
revoke all on function public.upsert_message_template(uuid, public.message_channel, public.message_event, text, text, text, text) from public;
grant execute on function public.list_message_templates(uuid) to authenticated;
grant execute on function public.upsert_message_template(uuid, public.message_channel, public.message_event, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140032_messages.sql — messages
-- ----------------------------------------------------------------------------

do $$ begin
  create type public.message_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
  create type public.message_direction as enum ('outbound', 'inbound');
exception when duplicate_object then null;
end $$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  channel public.message_channel not null,
  event public.message_event not null,
  recipient text not null,
  subject text,
  body text,
  payload jsonb not null default '{}'::jsonb,
  status public.message_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  dedupe_key text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index if not exists messages_dispatch_idx on public.messages (status, next_attempt_at);
create index if not exists messages_tenant_idx on public.messages (organization_id, tenant_id, created_at desc);
create trigger messages_set_updated_at before update on public.messages for each row execute function public.set_updated_at();

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction public.message_direction not null default 'outbound',
  status public.message_status not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists message_events_message_idx on public.message_events (message_id, created_at desc);

alter table public.messages enable row level security;
alter table public.message_events enable row level security;
drop policy if exists messages_select_member on public.messages;
drop policy if exists message_events_select_member on public.message_events;
create policy messages_select_member on public.messages for select to authenticated using (public.is_active_organization_member(organization_id));
create policy message_events_select_member on public.message_events for select to authenticated using (public.is_active_organization_member(organization_id));

create or replace function public.enqueue_message(
  target_organization_id uuid, target_tenant_id uuid, message_channel public.message_channel, message_event public.message_event,
  message_recipient text, message_payload jsonb, message_dedupe_key text
)
returns public.messages language plpgsql security definer set search_path = public
as $$
declare created_message public.messages;
begin
  insert into public.messages (organization_id, tenant_id, channel, event, recipient, payload, dedupe_key)
  values (target_organization_id, target_tenant_id, message_channel, message_event, btrim(message_recipient), coalesce(message_payload, '{}'::jsonb), message_dedupe_key)
  on conflict (organization_id, dedupe_key) do nothing
  returning * into created_message;
  return created_message;
end;
$$;

create or replace function public.enqueue_tenant_event(
  target_organization_id uuid, target_tenant_id uuid, message_event public.message_event, message_payload jsonb, dedupe_base text
)
returns integer language plpgsql security definer set search_path = public
as $$
declare tenant_record public.tenants;
declare current_channel public.message_channel;
declare recipient text;
declare created_count integer := 0;
declare created_message public.messages;
begin
  select * into tenant_record from public.tenants where id = target_tenant_id and organization_id = target_organization_id;
  if tenant_record.id is null then return 0; end if;
  foreach current_channel in array array['email', 'whatsapp']::public.message_channel[] loop
    recipient := case when current_channel = 'email' then tenant_record.email else tenant_record.phone end;
    if recipient is null or btrim(recipient) = '' then continue; end if;
    created_message := public.enqueue_message(target_organization_id, target_tenant_id, current_channel, message_event, recipient, message_payload, dedupe_base || ':' || current_channel);
    if created_message.id is not null then created_count := created_count + 1; end if;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.enqueue_message(uuid, uuid, public.message_channel, public.message_event, text, jsonb, text) from public;
revoke all on function public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text) from public;

-- ----------------------------------------------------------------------------
-- 202609140033_webhook_events.sql — webhook events
-- ----------------------------------------------------------------------------

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(btrim(provider)) between 1 and 40),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 200),
  organization_id uuid references public.organizations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);
create index if not exists webhook_events_received_idx on public.webhook_events (provider, received_at desc);

alter table public.webhook_events enable row level security;

-- ----------------------------------------------------------------------------
-- 202609140034_contact_preferences.sql — contact preferences
-- ----------------------------------------------------------------------------

create table if not exists public.tenant_contact_preferences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_opt_in boolean not null default true,
  whatsapp_opt_in boolean not null default true,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_contact_preferences enable row level security;
drop policy if exists tenant_contact_preferences_select_member on public.tenant_contact_preferences;
drop policy if exists tenant_contact_preferences_write_operator on public.tenant_contact_preferences;
create policy tenant_contact_preferences_select_member on public.tenant_contact_preferences for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenant_contact_preferences_write_operator on public.tenant_contact_preferences for all to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create trigger tenant_contact_preferences_set_updated_at before update on public.tenant_contact_preferences for each row execute function public.set_updated_at();

create or replace function public.get_tenant_preferences(target_organization_id uuid, target_tenant_id uuid)
returns table (email_opt_in boolean, whatsapp_opt_in boolean, consent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select coalesce(preference.email_opt_in, true), coalesce(preference.whatsapp_opt_in, true), preference.consent_at
  from (select 1) seed
  left join public.tenant_contact_preferences preference
    on preference.tenant_id = target_tenant_id and preference.organization_id = target_organization_id;
end;
$$;

create or replace function public.upsert_tenant_preferences(
  target_organization_id uuid, target_tenant_id uuid, preference_email_opt_in boolean, preference_whatsapp_opt_in boolean, preference_consent boolean
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  insert into public.tenant_contact_preferences (tenant_id, organization_id, email_opt_in, whatsapp_opt_in, consent_at)
  values (target_tenant_id, target_organization_id, coalesce(preference_email_opt_in, true), coalesce(preference_whatsapp_opt_in, true), case when preference_consent then now() else null end)
  on conflict (tenant_id) do update
    set email_opt_in = excluded.email_opt_in, whatsapp_opt_in = excluded.whatsapp_opt_in,
        consent_at = coalesce(excluded.consent_at, public.tenant_contact_preferences.consent_at);
end;
$$;

revoke all on function public.get_tenant_preferences(uuid, uuid) from public;
revoke all on function public.upsert_tenant_preferences(uuid, uuid, boolean, boolean, boolean) from public;
grant execute on function public.get_tenant_preferences(uuid, uuid) to authenticated;
grant execute on function public.upsert_tenant_preferences(uuid, uuid, boolean, boolean, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140035_finance_message_events.sql — finance message events
-- ----------------------------------------------------------------------------

create or replace function public.create_manual_invoice(target_organization_id uuid, target_tenant_id uuid, target_contract_id uuid, invoice_due_on date, invoice_amount numeric, invoice_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare created_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if invoice_amount <= 0 or not exists(select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'invalid invoice'; end if;
  if target_contract_id is not null and not exists(select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id and tenant_id = target_tenant_id) then raise exception 'invalid contract'; end if;
  insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, target_contract_id, target_tenant_id, invoice_due_on, invoice_due_on, invoice_due_on, invoice_amount, invoice_amount, nullif(trim(invoice_description), '')) returning * into created_invoice;
  perform public.enqueue_tenant_event(target_organization_id, target_tenant_id, 'invoice_created',
    jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target_tenant_id), 'amount', invoice_amount, 'due_on', to_char(invoice_due_on, 'YYYY-MM-DD'), 'description', coalesce(invoice_description, '')),
    'invoice:' || created_invoice.id || ':created');
  return created_invoice;
end;
$$;

create or replace function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; period_start date; next_start date; period_end date; count_created integer := 0; interval_value integer; interval_unit public.billing_interval_unit; inserted_invoice_id uuid; inserted_amount numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  for c in select * from public.rental_contracts where organization_id = target_organization_id and status = 'active' loop
    interval_value := case c.billing_frequency when 'daily' then 1 when 'weekly' then 1 when 'fortnightly' then 2 when 'monthly' then 1 else c.billing_custom_interval end;
    interval_unit := case c.billing_frequency when 'daily' then 'day'::public.billing_interval_unit when 'weekly' then 'week'::public.billing_interval_unit when 'fortnightly' then 'week'::public.billing_interval_unit when 'monthly' then 'month'::public.billing_interval_unit else c.billing_custom_unit end;
    period_start := c.starts_on;
    while period_start <= least(generate_until, c.expected_return_on) loop
      next_start := case interval_unit when 'day' then period_start + interval_value when 'week' then period_start + (interval_value * 7) else (period_start + make_interval(months => interval_value))::date end;
      period_end := least(next_start - 1, c.expected_return_on);
      inserted_amount := round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2);
      inserted_invoice_id := null;
      insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.id, c.tenant_id, period_start, period_end, period_end, inserted_amount, inserted_amount, 'Cobrança de locação')
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
      returning id into inserted_invoice_id;
      if inserted_invoice_id is not null then
        count_created := count_created + 1;
        perform public.enqueue_tenant_event(target_organization_id, c.tenant_id, 'invoice_created',
          jsonb_build_object('tenant_name', (select full_name from public.tenants where id = c.tenant_id), 'amount', inserted_amount, 'due_on', to_char(period_end, 'YYYY-MM-DD'), 'description', 'Cobrança de locação'),
          'invoice:' || inserted_invoice_id || ':created');
      end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return count_created;
end;
$$;

create or replace function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note) values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), '')) returning * into created_payment;
  update public.invoices set amount_paid = new_paid, status = case when new_paid = target_invoice.amount_due then 'paid' when target_invoice.due_on < current_date then 'overdue' else 'pending' end where id = target_invoice_id;
  perform public.enqueue_tenant_event(target_organization_id, target_invoice.tenant_id, 'payment_receipt',
    jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target_invoice.tenant_id), 'amount', payment_amount, 'paid_on', to_char(payment_paid_on, 'YYYY-MM-DD')),
    'payment:' || created_payment.id || ':receipt');
  return created_payment;
end;
$$;

-- ----------------------------------------------------------------------------
-- 202609140036_messaging_read_rpcs.sql — messaging read rpcs
-- ----------------------------------------------------------------------------

create or replace function public.list_messages(
  target_organization_id uuid, filter_status public.message_status default null, filter_channel public.message_channel default null
)
returns table (id uuid, tenant_id uuid, tenant_name text, channel public.message_channel, event public.message_event, recipient text, subject text, body text, status public.message_status, attempts integer, last_error text, provider_message_id text, created_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select message.id, message.tenant_id, tenant.full_name, message.channel, message.event, message.recipient, message.subject, message.body, message.status,
    message.attempts, message.last_error, message.provider_message_id, message.created_at, message.sent_at
  from public.messages message
  left join public.tenants tenant on tenant.id = message.tenant_id
  where message.organization_id = target_organization_id
    and (filter_status is null or message.status = filter_status)
    and (filter_channel is null or message.channel = filter_channel)
  order by message.created_at desc
  limit 500;
end;
$$;

create or replace function public.list_tenant_communications(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, channel public.message_channel, event public.message_event, recipient text, subject text, body text, status public.message_status, attempts integer, last_error text, created_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select message.id, message.channel, message.event, message.recipient, message.subject, message.body, message.status, message.attempts, message.last_error, message.created_at, message.sent_at
  from public.messages message
  where message.organization_id = target_organization_id and message.tenant_id = target_tenant_id
  order by message.created_at desc
  limit 200;
end;
$$;

create or replace function public.retry_message(target_organization_id uuid, target_message_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  update public.messages set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
  where id = target_message_id and organization_id = target_organization_id;
  if not found then raise exception 'message not found'; end if;
end;
$$;

create or replace function public.enqueue_member_invite(target_organization_id uuid, member_email text, member_name text)
returns public.messages language plpgsql security definer set search_path = public
as $$
declare organization_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  select name into organization_name from public.organizations where id = target_organization_id;
  return public.enqueue_message(target_organization_id, null, 'email', 'member_invite', btrim(member_email),
    jsonb_build_object('member_name', coalesce(nullif(btrim(member_name), ''), btrim(member_email)), 'organization_name', coalesce(organization_name, 'SGA')),
    'member:' || lower(btrim(member_email)) || ':invite');
end;
$$;

create or replace function public.enqueue_due_reminders(target_organization_id uuid, horizon_days integer default 3)
returns integer language plpgsql security definer set search_path = public
as $$
declare target record; created_count integer := 0;
begin
  for target in
    select invoice.id, invoice.tenant_id, invoice.due_on, invoice.amount_due,
      case when invoice.due_on < current_date then 'invoice_overdue' else 'invoice_due_soon' end as reminder_event
    from public.invoices invoice
    where invoice.organization_id = target_organization_id
      and invoice.status in ('pending', 'overdue')
      and invoice.amount_due > invoice.amount_paid
      and invoice.due_on <= current_date + greatest(coalesce(horizon_days, 0), 0)
  loop
    created_count := created_count + public.enqueue_tenant_event(target_organization_id, target.tenant_id, target.reminder_event::public.message_event,
      jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target.tenant_id), 'amount', target.amount_due, 'due_on', to_char(target.due_on, 'YYYY-MM-DD')),
      'invoice:' || target.id || ':' || target.reminder_event || ':' || to_char(target.due_on, 'YYYY-MM-DD'));
  end loop;
  return created_count;
end;
$$;

revoke all on function public.list_messages(uuid, public.message_status, public.message_channel) from public;
revoke all on function public.list_tenant_communications(uuid, uuid) from public;
revoke all on function public.retry_message(uuid, uuid) from public;
revoke all on function public.enqueue_member_invite(uuid, text, text) from public;
revoke all on function public.enqueue_due_reminders(uuid, integer) from public;
grant execute on function public.list_messages(uuid, public.message_status, public.message_channel) to authenticated;
grant execute on function public.list_tenant_communications(uuid, uuid) to authenticated;
grant execute on function public.retry_message(uuid, uuid) to authenticated;
grant execute on function public.enqueue_member_invite(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140037_dashboard_reports.sql — dashboard reports
-- ----------------------------------------------------------------------------

create table public.dashboard_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  created_at timestamptz not null default now()
);

create index dashboard_reports_owner_idx on public.dashboard_reports (organization_id, user_id, created_at desc);
alter table public.dashboard_reports enable row level security;
create policy dashboard_reports_select_own on public.dashboard_reports for select to authenticated using (user_id = auth.uid() and public.is_active_organization_member(organization_id));
create policy dashboard_reports_insert_own on public.dashboard_reports for insert to authenticated with check (user_id = auth.uid() and public.is_active_organization_member(organization_id));
create policy dashboard_reports_delete_own on public.dashboard_reports for delete to authenticated using (user_id = auth.uid() and public.is_active_organization_member(organization_id));

create function public.dashboard_received_amount(target_organization_id uuid, period_starts_on date, period_ends_on date)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  if period_ends_on < period_starts_on then raise exception 'invalid period'; end if;
  return coalesce((select sum(amount) from public.payments where organization_id = target_organization_id and paid_on between period_starts_on and period_ends_on), 0);
end;
$$;

create function public.list_dashboard_reports(target_organization_id uuid)
returns table (id uuid, name text, starts_on date, ends_on date, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select r.id, r.name, r.starts_on, r.ends_on, r.created_at from public.dashboard_reports r where r.organization_id = target_organization_id and r.user_id = auth.uid() order by r.created_at desc;
end;
$$;

create function public.save_dashboard_report(target_organization_id uuid, report_name text, period_starts_on date, period_ends_on date)
returns public.dashboard_reports language plpgsql security definer set search_path = public as $$
declare created_report public.dashboard_reports;
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  if char_length(trim(report_name)) not between 1 and 80 or period_ends_on < period_starts_on then raise exception 'invalid dashboard report'; end if;
  insert into public.dashboard_reports (organization_id, user_id, name, starts_on, ends_on) values (target_organization_id, auth.uid(), trim(report_name), period_starts_on, period_ends_on) returning * into created_report;
  return created_report;
end;
$$;

revoke all on function public.dashboard_received_amount(uuid, date, date), public.list_dashboard_reports(uuid), public.save_dashboard_report(uuid, text, date, date) from public;
grant execute on function public.dashboard_received_amount(uuid, date, date), public.list_dashboard_reports(uuid), public.save_dashboard_report(uuid, text, date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140038_meta_whatsapp_templates.sql — meta whatsapp templates
-- ----------------------------------------------------------------------------

create table public.meta_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 3 and 100),
  name text not null unique check (char_length(name) between 3 and 512),
  body text not null check (char_length(btrim(body)) between 1 and 1024),
  scheduled_at time not null,
  status text not null default 'local' check (status in ('local', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'unknown')),
  meta_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger meta_whatsapp_templates_set_updated_at before update on public.meta_whatsapp_templates for each row execute function public.set_updated_at();
alter table public.meta_whatsapp_templates enable row level security;
create policy meta_whatsapp_templates_read_active_member on public.meta_whatsapp_templates for select to authenticated using (exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id where m.user_id = auth.uid() and o.status = 'active'));

insert into public.meta_whatsapp_templates (code, name, body, scheduled_at) values
('daily_invoice_2000', 'sga_daily_invoice_2000', 'Olá, {{1}}. O boleto/Pix da sua diária de locação já está disponível. Lembramos que a manutenção preventiva e o desgaste dos pneus são de responsabilidade do locatário. Garanta o pagamento para evitar restrições: {{2}}.', '20:00'),
('payment_reminder_2030', 'sga_payment_reminder_2030', 'Oi, {{1}}. Identificamos que o boleto da diária segue aguardando pagamento. Evite o bloqueio sistêmico do veículo realizando o pagamento no link: {{2}}.', '20:30'),
('pending_alert_2100', 'sga_pending_alert_2100', 'Atenção, {{1}}: seu boleto da locação continua pendente. Regularize o saldo agora para evitar o bloqueio preventivo do veículo: {{2}}.', '21:00'),
('scheduled_block_2130', 'sga_scheduled_block_2130', 'Aviso importante: O bloqueio do veículo está programado no sistema devido à ausência de pagamento da diária. Evite transtornos efetuando o pagamento: {{1}}.', '21:30'),
('critical_security_2200', 'sga_critical_security_2200', 'AVISO DE SEGURANÇA: Pagamento pendente. O veículo {{1}} será bloqueado sistemicamente a qualquer momento por quebra de contrato. Regularize imediatamente.', '22:00'),
('penultimate_notice_2230', 'sga_penultimate_notice_2230', 'Este é o último alerta amigável sobre a pendência da sua diária de locação. O bloqueio remoto do veículo está em andamento. Link para pagamento: {{1}}.', '22:30'),
('final_notice_2300', 'sga_final_notice_2300', 'ÚLTIMO AVISO! Fatura não compensada. O bloqueio total dos serviços e do veículo é iminente. Entre em contato ou pague agora: {{1}}.', '23:00')
on conflict (code) do update set body = excluded.body, scheduled_at = excluded.scheduled_at;

revoke all on table public.meta_whatsapp_templates from public;
grant select on table public.meta_whatsapp_templates to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140039_organization_whatsapp_connections.sql — organization whatsapp connections
-- ----------------------------------------------------------------------------

create table public.organization_whatsapp_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  business_account_id text not null check (char_length(btrim(business_account_id)) between 1 and 100),
  phone_number_id text not null check (char_length(btrim(phone_number_id)) between 1 and 100),
  access_token_ciphertext text not null check (char_length(access_token_ciphertext) > 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organization_whatsapp_connections_set_updated_at before update on public.organization_whatsapp_connections for each row execute function public.set_updated_at();
alter table public.organization_whatsapp_connections enable row level security;
create policy organization_whatsapp_connections_no_client_access on public.organization_whatsapp_connections for select to authenticated using (false);

alter table public.meta_whatsapp_templates add column organization_id uuid references public.organizations(id) on delete cascade;
alter table public.meta_whatsapp_templates drop constraint meta_whatsapp_templates_code_key;
alter table public.meta_whatsapp_templates add constraint meta_whatsapp_templates_organization_code_key unique nulls not distinct (organization_id, code);
create index meta_whatsapp_templates_organization_idx on public.meta_whatsapp_templates (organization_id, scheduled_at);
drop policy meta_whatsapp_templates_read_active_member on public.meta_whatsapp_templates;
create policy meta_whatsapp_templates_read_organization_member on public.meta_whatsapp_templates for select to authenticated using (organization_id is not null and public.is_active_organization_member(organization_id));

create function public.ensure_organization_meta_whatsapp_templates(target_organization_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, scheduled_at)
  select target_organization_id, source.code, 'sga_' || substr(replace(target_organization_id::text, '-', ''), 1, 12) || '_' || source.code, source.body, source.scheduled_at
  from public.meta_whatsapp_templates source where source.organization_id is null
  on conflict (organization_id, code) do nothing;
end;
$$;
create function public.list_organization_meta_whatsapp_templates(target_organization_id uuid)
returns table (id uuid, code text, name text, body text, scheduled_at time, status text, rejection_reason text, last_synced_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select t.id, t.code, t.name, t.body, t.scheduled_at, t.status, t.rejection_reason, t.last_synced_at from public.meta_whatsapp_templates t where t.organization_id = target_organization_id order by t.scheduled_at;
end;
$$;
create function public.get_organization_whatsapp_connection_status(target_organization_id uuid)
returns table (business_account_id text, phone_number_id text, configured boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query select c.business_account_id, c.phone_number_id, true from public.organization_whatsapp_connections c where c.organization_id = target_organization_id;
end;
$$;
revoke all on function public.ensure_organization_meta_whatsapp_templates(uuid), public.list_organization_meta_whatsapp_templates(uuid), public.get_organization_whatsapp_connection_status(uuid) from public;
grant execute on function public.ensure_organization_meta_whatsapp_templates(uuid), public.list_organization_meta_whatsapp_templates(uuid), public.get_organization_whatsapp_connection_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609140040_meta_template_form_fields.sql — meta template form fields
-- ----------------------------------------------------------------------------

alter table public.meta_whatsapp_templates
  add column category text not null default 'UTILITY' check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  add column language text not null default 'pt_BR' check (char_length(language) between 2 and 20),
  add column body_examples jsonb not null default '[]'::jsonb check (jsonb_typeof(body_examples) = 'array');

create function public.create_organization_meta_whatsapp_template(target_organization_id uuid, template_name text, template_category text, template_language text, template_body text, template_examples jsonb)
returns public.meta_whatsapp_templates language plpgsql security definer set search_path = public as $$
declare saved public.meta_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if template_name !~ '^[a-z][a-z0-9_]{2,511}$' or template_category not in ('UTILITY', 'MARKETING', 'AUTHENTICATION') or char_length(trim(template_body)) not between 1 and 1024 or jsonb_typeof(coalesce(template_examples, '[]'::jsonb)) <> 'array' then raise exception 'invalid Meta template'; end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150001_organization_invitations.sql — organization invitations
-- ----------------------------------------------------------------------------

-- Convites de membros com token e aceite.
-- O token bruto nunca é armazenado: o SGA grava apenas o hash SHA-256 calculado no servidor.

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'operations',
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint organization_invitations_role_check check (role <> 'owner')
);

create unique index if not exists organization_invitations_pending_email_idx
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

create index if not exists organization_invitations_org_idx
  on public.organization_invitations (organization_id, created_at desc);

alter table public.organization_invitations enable row level security;

drop policy if exists organization_invitations_select_manager on public.organization_invitations;
create policy organization_invitations_select_manager on public.organization_invitations
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create or replace function public.create_organization_invitation(
  target_organization_id uuid,
  member_email text,
  member_role public.organization_role,
  invitation_token_hash text,
  invitation_expires_at timestamptz
)
returns public.organization_invitations
language plpgsql security definer set search_path = public
as $$
declare created public.organization_invitations;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if member_role = 'owner' then raise exception 'owner role cannot be invited'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  if coalesce(btrim(invitation_token_hash), '') = '' then raise exception 'invitation token is required'; end if;
  delete from public.organization_invitations
  where organization_id = target_organization_id and lower(email) = lower(btrim(member_email)) and accepted_at is null;
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, expires_at)
  values (target_organization_id, lower(btrim(member_email)), member_role, btrim(invitation_token_hash), auth.uid(), invitation_expires_at)
  returning * into created;
  return created;
end;
$$;

create or replace function public.list_organization_invitations(target_organization_id uuid)
returns table (id uuid, email text, role public.organization_role, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select invitation.id, invitation.email, invitation.role, invitation.expires_at, invitation.created_at
    from public.organization_invitations invitation
    where invitation.organization_id = target_organization_id and invitation.accepted_at is null
    order by invitation.created_at desc;
end;
$$;

create or replace function public.revoke_organization_invitation(target_organization_id uuid, target_invitation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  delete from public.organization_invitations
  where id = target_invitation_id and organization_id = target_organization_id and accepted_at is null;
  if not found then raise exception 'invitation not found'; end if;
end;
$$;

create or replace function public.get_organization_invitation(invitation_token_hash text)
returns table (id uuid, organization_id uuid, organization_name text, email text, role public.organization_role, expires_at timestamptz, accepted_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select invitation.id, invitation.organization_id, organization.name, invitation.email, invitation.role, invitation.expires_at, invitation.accepted_at
  from public.organization_invitations invitation
  join public.organizations organization on organization.id = invitation.organization_id
  where invitation.token_hash = invitation_token_hash
  limit 1;
$$;

create or replace function public.accept_organization_invitation(invitation_token_hash text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare invitation public.organization_invitations; current_email text; organization_state public.organization_status;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.organization_invitations where token_hash = invitation_token_hash limit 1;
  if invitation.id is null then raise exception 'invitation not found'; end if;
  if invitation.accepted_at is not null then raise exception 'invitation already accepted'; end if;
  if invitation.expires_at < now() then raise exception 'invitation expired'; end if;
  select lower(email) into current_email from auth.users where id = auth.uid();
  if current_email is null or current_email <> lower(invitation.email) then raise exception 'invitation email does not match the signed-in account'; end if;
  select status into organization_state from public.organizations where id = invitation.organization_id;
  if organization_state <> 'active' then raise exception 'organization is not active'; end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), invitation.role)
  on conflict (organization_id, user_id) do update set role = excluded.role
  where public.organization_members.role <> 'owner';
  if not found then raise exception 'owner role cannot be changed'; end if;
  update public.organization_invitations set accepted_at = now() where id = invitation.id;
  return invitation.organization_id;
end;
$$;

create or replace function public.enqueue_organization_invite(target_organization_id uuid, member_email text, member_name text, invite_url text)
returns public.messages
language plpgsql security definer set search_path = public
as $$
declare organization_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  select name into organization_name from public.organizations where id = target_organization_id;
  return public.enqueue_message(target_organization_id, null, 'email', 'member_invite', btrim(member_email),
    jsonb_build_object(
      'member_name', coalesce(nullif(btrim(member_name), ''), btrim(member_email)),
      'organization_name', coalesce(organization_name, 'SGA'),
      'invite_url', coalesce(btrim(invite_url), '')
    ),
    'member:' || lower(btrim(member_email)) || ':invite:' || to_char(now(), 'YYYYMMDDHH24MISS'));
end;
$$;

update public.message_templates
set body = 'Olá {{member_name}}, você foi convidado para a equipe de {{organization_name}} no SGA. Aceite o convite em: {{invite_url}}'
where organization_id is null and channel = 'email' and event = 'member_invite';

revoke all on function public.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) from public;
revoke all on function public.list_organization_invitations(uuid) from public;
revoke all on function public.revoke_organization_invitation(uuid, uuid) from public;
revoke all on function public.get_organization_invitation(text) from public;
revoke all on function public.accept_organization_invitation(text) from public;
revoke all on function public.enqueue_organization_invite(uuid, text, text, text) from public;

grant execute on function public.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid, uuid) to authenticated;
grant execute on function public.get_organization_invitation(text) to anon, authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.enqueue_organization_invite(uuid, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150002_invoice_items.sql — invoice items
-- ----------------------------------------------------------------------------

-- Composição de faturas por itens (modelo invoices ─ invoice_items).
-- As colunas legadas de invoices continuam existindo e passam a ser derivadas dos itens.

create type public.invoice_item_type as enum ('base', 'discount', 'additional', 'fine', 'interest', 'fee', 'deposit', 'deposit_refund', 'extra_daily', 'damage');

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  type public.invoice_item_type not null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_amount numeric(14,2) not null default 0,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, created_at);

alter table public.invoice_items enable row level security;

drop policy if exists invoice_items_select_member on public.invoice_items;
create policy invoice_items_select_member on public.invoice_items
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

-- Backfill: base, desconto, acréscimo, multa e juros a partir das colunas existentes.
insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
select invoice.organization_id, invoice.id, 'base', coalesce(nullif(btrim(invoice.description), ''), 'Período de locação'), 1, invoice.subtotal, invoice.subtotal
from public.invoices invoice;

insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
select organization_id, id, 'discount', 'Desconto', 1, discount_amount, -discount_amount from public.invoices where discount_amount > 0;

insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
select organization_id, id, 'additional', 'Acréscimo', 1, additional_amount, additional_amount from public.invoices where additional_amount > 0;

insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
select organization_id, id, 'fine', 'Multa', 1, fine_amount, fine_amount from public.invoices where fine_amount > 0;

insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
select organization_id, id, 'interest', 'Juros', 1, interest_amount, interest_amount from public.invoices where interest_amount > 0;

create or replace function public.refresh_invoice_totals(target_invoice_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare invoice_row public.invoices; totals record; updated public.invoices;
begin
  select * into invoice_row from public.invoices where id = target_invoice_id;
  if invoice_row.id is null then raise exception 'invoice not found'; end if;
  select
    coalesce(sum(amount) filter (where type = 'base'), 0) as base_total,
    coalesce(-sum(amount) filter (where type = 'discount'), 0) as discount_total,
    coalesce(sum(amount) filter (where type = 'additional'), 0) as additional_total,
    coalesce(sum(amount) filter (where type = 'fine'), 0) as fine_total,
    coalesce(sum(amount) filter (where type = 'interest'), 0) as interest_total,
    coalesce(sum(amount), 0) as net_total
  into totals
  from public.invoice_items where invoice_id = target_invoice_id;
  if totals.net_total < invoice_row.amount_paid then raise exception 'invoice total cannot be lower than paid amount'; end if;
  update public.invoices set
    subtotal = greatest(totals.base_total, 0),
    discount_amount = greatest(totals.discount_total, 0),
    additional_amount = greatest(totals.additional_total, 0),
    fine_amount = greatest(totals.fine_total, 0),
    interest_amount = greatest(totals.interest_total, 0),
    amount_due = greatest(totals.net_total, 0),
    status = (case when invoice_row.amount_paid = greatest(totals.net_total, 0) then 'paid' when invoice_row.due_on < current_date then 'overdue' else 'pending' end)::public.invoice_status,
    updated_at = now()
  where id = target_invoice_id
  returning * into updated;
  return updated;
end;
$$;

create or replace function public.list_invoice_items(target_organization_id uuid, target_invoice_id uuid)
returns setof public.invoice_items
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select * from public.invoice_items where invoice_id = target_invoice_id and organization_id = target_organization_id order by created_at;
end;
$$;

-- Ajustes passam a registrar item e recalcular a fatura a partir dos itens.
create or replace function public.apply_invoice_adjustment(
  target_organization_id uuid,
  target_invoice_id uuid,
  adjustment_type public.invoice_adjustment_type,
  adjustment_amount numeric,
  adjustment_description text
)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare target_invoice public.invoices; signed_amount numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if adjustment_type = 'renegotiation' then raise exception 'use renegotiate_invoice for renegotiation'; end if;
  if adjustment_amount <= 0 then raise exception 'adjustment amount must be positive'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id;
  if target_invoice.id is null then raise exception 'invoice not found'; end if;
  if target_invoice.status in ('cancelled', 'reversed') then raise exception 'invoice cannot be adjusted'; end if;
  signed_amount := case when adjustment_type = 'discount' then -adjustment_amount else adjustment_amount end;
  if adjustment_type = 'discount' and greatest(target_invoice.amount_due - adjustment_amount, 0) < target_invoice.amount_paid then raise exception 'adjustment cannot reduce the invoice below paid amount'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description)
  values (target_organization_id, target_invoice_id, adjustment_type, adjustment_amount, btrim(adjustment_description));
  insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
  values (target_organization_id, target_invoice_id, adjustment_type::text::public.invoice_item_type, btrim(adjustment_description), 1, signed_amount, signed_amount);
  return public.refresh_invoice_totals(target_invoice_id);
end;
$$;

create or replace function public.renegotiate_invoice(
  target_organization_id uuid,
  target_invoice_id uuid,
  renegotiated_due_on date,
  renegotiated_amount numeric,
  renegotiation_description text
)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare target_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if renegotiated_amount <= 0 then raise exception 'renegotiated amount must be positive'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id;
  if target_invoice.id is null then raise exception 'invoice not found'; end if;
  if target_invoice.amount_paid > renegotiated_amount then raise exception 'renegotiated amount cannot be lower than paid amount'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description)
  values (target_organization_id, target_invoice_id, 'renegotiation', renegotiated_amount - target_invoice.amount_due, btrim(renegotiation_description));
  delete from public.invoice_items where invoice_id = target_invoice_id;
  insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
  values (target_organization_id, target_invoice_id, 'base', coalesce(nullif(btrim(renegotiation_description), ''), 'Renegociação'), 1, renegotiated_amount, renegotiated_amount);
  update public.invoices set due_on = renegotiated_due_on where id = target_invoice_id;
  return public.refresh_invoice_totals(target_invoice_id);
end;
$$;

create or replace function public.create_manual_invoice(
  target_organization_id uuid,
  target_tenant_id uuid,
  target_contract_id uuid,
  invoice_due_on date,
  invoice_amount numeric,
  invoice_description text
)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare created public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if invoice_amount <= 0 then raise exception 'invoice amount must be positive'; end if;
  insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, target_tenant_id, target_contract_id, invoice_due_on, invoice_due_on, invoice_due_on, round(invoice_amount, 2), round(invoice_amount, 2), nullif(btrim(invoice_description), ''))
  returning * into created;
  insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
  values (target_organization_id, created.id, 'base', coalesce(nullif(btrim(invoice_description), ''), 'Cobrança avulsa'), 1, round(invoice_amount, 2), round(invoice_amount, 2));
  perform public.enqueue_tenant_event(target_organization_id, target_tenant_id, 'invoice_created',
    jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target_tenant_id), 'amount', created.amount_due, 'due_on', to_char(created.due_on, 'YYYY-MM-DD')),
    'invoice:' || created.id || ':created');
  return created;
end;
$$;

create or replace function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare c public.rental_contracts; interval_value integer; interval_unit public.billing_interval_unit; period_start date; next_start date; period_end date; inserted_invoice_id uuid; inserted_amount numeric; created_count integer := 0;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  for c in select * from public.rental_contracts where organization_id = target_organization_id and status = 'active' loop
    interval_value := case c.billing_frequency when 'daily' then 1 when 'weekly' then 1 when 'fortnightly' then 2 when 'monthly' then 1 else c.billing_custom_interval end;
    interval_unit := case c.billing_frequency when 'daily' then 'day'::public.billing_interval_unit when 'weekly' then 'week'::public.billing_interval_unit when 'fortnightly' then 'week'::public.billing_interval_unit when 'monthly' then 'month'::public.billing_interval_unit else c.billing_custom_unit end;
    period_start := c.starts_on;
    while period_start <= least(generate_until, c.expected_return_on) loop
      next_start := case interval_unit when 'day' then period_start + interval_value when 'week' then period_start + (interval_value * 7) else (period_start + make_interval(months => interval_value))::date end;
      period_end := least(next_start - 1, c.expected_return_on);
      inserted_amount := round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2);
      inserted_invoice_id := null;
      insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.tenant_id, c.id, period_start, period_end, period_end, inserted_amount, inserted_amount, 'Locação ' || to_char(period_start, 'DD/MM/YYYY') || ' a ' || to_char(period_end, 'DD/MM/YYYY'))
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
      returning id into inserted_invoice_id;
      if inserted_invoice_id is not null then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, inserted_invoice_id, 'base', 'Período de locação', (period_end - period_start + 1), c.daily_rate, inserted_amount);
        perform public.enqueue_tenant_event(target_organization_id, c.tenant_id, 'invoice_created',
          jsonb_build_object('tenant_name', (select full_name from public.tenants where id = c.tenant_id), 'amount', inserted_amount, 'due_on', to_char(period_end, 'YYYY-MM-DD')),
          'invoice:' || inserted_invoice_id || ':created');
        created_count := created_count + 1;
      end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return created_count;
end;
$$;

drop function if exists public.list_invoices(uuid);

create or replace function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, subtotal numeric, discount_amount numeric, additional_amount numeric, fine_amount numeric, interest_amount numeric, deposit_amount numeric, fee_amount numeric, extra_amount numeric, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices as invoice
  set status = 'overdue'
  where invoice.organization_id = target_organization_id and invoice.status = 'pending' and invoice.due_on < current_date;
  return query
  select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name, invoice.due_on, invoice.subtotal, invoice.discount_amount, invoice.additional_amount,
    invoice.fine_amount, invoice.interest_amount,
    coalesce((select sum(item.amount) from public.invoice_items item where item.invoice_id = invoice.id and item.type = 'deposit'), 0) as deposit_amount,
    coalesce((select sum(item.amount) from public.invoice_items item where item.invoice_id = invoice.id and item.type = 'fee'), 0) as fee_amount,
    coalesce((select sum(item.amount) from public.invoice_items item where item.invoice_id = invoice.id and item.type in ('extra_daily', 'damage', 'deposit_refund')), 0) as extra_amount,
    invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description, invoice.created_at
  from public.invoices as invoice
  join public.tenants as tenant on tenant.id = invoice.tenant_id
  where invoice.organization_id = target_organization_id
  order by invoice.due_on asc, invoice.created_at desc;
end;
$$;

create or replace function public.add_invoice_fee(target_organization_id uuid, target_invoice_id uuid, fee_description text, fee_amount numeric)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare target_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if fee_amount <= 0 then raise exception 'fee amount must be positive'; end if;
  if coalesce(btrim(fee_description), '') = '' then raise exception 'fee description is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id;
  if target_invoice.id is null then raise exception 'invoice not found'; end if;
  if target_invoice.status in ('cancelled', 'reversed') then raise exception 'invoice cannot receive fees'; end if;
  insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
  values (target_organization_id, target_invoice_id, 'fee', btrim(fee_description), 1, round(fee_amount, 2), round(fee_amount, 2));
  return public.refresh_invoice_totals(target_invoice_id);
end;
$$;

revoke all on function public.list_invoice_items(uuid, uuid) from public;
revoke all on function public.refresh_invoice_totals(uuid) from public;
revoke all on function public.add_invoice_fee(uuid, uuid, text, numeric) from public;
grant execute on function public.list_invoice_items(uuid, uuid) to authenticated;
grant execute on function public.add_invoice_fee(uuid, uuid, text, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150003_contract_deposit_and_fees.sql — contract deposit and fees
-- ----------------------------------------------------------------------------

-- Caução (security deposit) e taxas próprias do contrato.

do $$
begin
  create type public.deposit_status as enum ('none', 'pending', 'held', 'refunded', 'retained');
exception
  when duplicate_object then null;
end $$;

alter table public.rental_contracts
  add column if not exists security_deposit_amount numeric(14,2) not null default 0,
  add column if not exists security_deposit_status public.deposit_status not null default 'none',
  add column if not exists security_deposit_notes text;

alter table public.rental_contracts
  drop constraint if exists rental_contracts_deposit_amount_check;
alter table public.rental_contracts
  add constraint rental_contracts_deposit_amount_check check (security_deposit_amount >= 0);

create table if not exists public.contract_fees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  name text not null,
  amount numeric(14,2) not null check (amount > 0),
  recurrence text not null default 'recurring' check (recurrence in ('one_time', 'recurring')),
  created_at timestamptz not null default now()
);

create index if not exists contract_fees_contract_idx on public.contract_fees (contract_id, created_at);

alter table public.contract_fees enable row level security;

drop policy if exists contract_fees_select_member on public.contract_fees;
create policy contract_fees_select_member on public.contract_fees
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.set_contract_deposit(target_organization_id uuid, target_contract_id uuid, deposit_amount numeric)
returns public.rental_contracts
language plpgsql security definer set search_path = public
as $$
declare updated public.rental_contracts;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if deposit_amount < 0 then raise exception 'deposit amount cannot be negative'; end if;
  update public.rental_contracts
  set security_deposit_amount = round(deposit_amount, 2),
      security_deposit_status = case when deposit_amount > 0 then 'pending'::public.deposit_status else 'none'::public.deposit_status end,
      updated_at = now()
  where id = target_contract_id and organization_id = target_organization_id
  returning * into updated;
  if updated.id is null then raise exception 'contract not found'; end if;
  return updated;
end;
$$;

create or replace function public.charge_contract_deposit(target_organization_id uuid, target_contract_id uuid, deposit_due_on date, deposit_description text default 'Caução')
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare contract_row public.rental_contracts; created public.invoices; existing public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into contract_row from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id;
  if contract_row.id is null then raise exception 'contract not found'; end if;
  if contract_row.security_deposit_amount <= 0 then raise exception 'contract has no security deposit'; end if;
  select invoice.* into existing
  from public.invoices invoice
  join public.invoice_items item on item.invoice_id = invoice.id
  where invoice.contract_id = target_contract_id and invoice.organization_id = target_organization_id and item.type = 'deposit' and invoice.status not in ('cancelled', 'reversed')
  limit 1;
  if existing.id is not null then return existing; end if;
  insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, contract_row.tenant_id, target_contract_id, deposit_due_on, deposit_due_on, deposit_due_on, contract_row.security_deposit_amount, contract_row.security_deposit_amount, coalesce(nullif(btrim(deposit_description), ''), 'Caução'))
  returning * into created;
  insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
  values (target_organization_id, created.id, 'deposit', coalesce(nullif(btrim(deposit_description), ''), 'Caução'), 1, contract_row.security_deposit_amount, contract_row.security_deposit_amount);
  update public.rental_contracts set security_deposit_status = 'held', updated_at = now() where id = target_contract_id;
  return public.refresh_invoice_totals(created.id);
end;
$$;

create or replace function public.settle_contract_deposit(target_organization_id uuid, target_contract_id uuid, deposit_resolution public.deposit_status, deposit_note text)
returns public.rental_contracts
language plpgsql security definer set search_path = public
as $$
declare updated public.rental_contracts;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if deposit_resolution not in ('refunded', 'retained') then raise exception 'resolution must be refunded or retained'; end if;
  update public.rental_contracts
  set security_deposit_status = deposit_resolution,
      security_deposit_notes = nullif(btrim(coalesce(security_deposit_notes, '') || case when coalesce(btrim(deposit_note), '') = '' then '' else E'\n' || btrim(deposit_note) end), ''),
      updated_at = now()
  where id = target_contract_id and organization_id = target_organization_id
  returning * into updated;
  if updated.id is null then raise exception 'contract not found'; end if;
  return updated;
end;
$$;

create or replace function public.add_contract_fee(target_organization_id uuid, target_contract_id uuid, fee_name text, fee_amount numeric, fee_recurrence text default 'recurring')
returns public.contract_fees
language plpgsql security definer set search_path = public
as $$
declare created public.contract_fees;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if coalesce(btrim(fee_name), '') = '' then raise exception 'fee name is required'; end if;
  if fee_amount <= 0 then raise exception 'fee amount must be positive'; end if;
  if fee_recurrence not in ('one_time', 'recurring') then raise exception 'invalid fee recurrence'; end if;
  if not exists (select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id) then raise exception 'contract not found'; end if;
  insert into public.contract_fees (organization_id, contract_id, name, amount, recurrence)
  values (target_organization_id, target_contract_id, btrim(fee_name), round(fee_amount, 2), fee_recurrence)
  returning * into created;
  return created;
end;
$$;

create or replace function public.remove_contract_fee(target_organization_id uuid, target_fee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.contract_fees where id = target_fee_id and organization_id = target_organization_id;
  if not found then raise exception 'fee not found'; end if;
end;
$$;

create or replace function public.list_contract_fees(target_organization_id uuid, target_contract_id uuid)
returns setof public.contract_fees
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select * from public.contract_fees where contract_id = target_contract_id and organization_id = target_organization_id order by created_at;
end;
$$;

drop function if exists public.list_rental_contracts(uuid);

create or replace function public.list_rental_contracts(target_organization_id uuid)
returns table (id uuid, tenant_id uuid, tenant_name text, vehicle_id uuid, vehicle_brand text, vehicle_model text, vehicle_plate text, starts_on date, expected_return_on date, actual_return_on date, daily_rate numeric, billing_frequency public.billing_frequency, billing_time time, billing_custom_interval integer, billing_custom_unit public.billing_interval_unit, status public.rental_contract_status, security_deposit_amount numeric, security_deposit_status public.deposit_status, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select contract.id, contract.tenant_id, tenant.full_name, contract.vehicle_id, vehicle.brand, vehicle.model, vehicle.plate, contract.starts_on, contract.expected_return_on, contract.actual_return_on, contract.daily_rate, contract.billing_frequency, contract.billing_time, contract.billing_custom_interval, contract.billing_custom_unit, contract.status, contract.security_deposit_amount, contract.security_deposit_status, contract.created_at
  from public.rental_contracts contract
  join public.tenants tenant on tenant.id = contract.tenant_id
  join public.vehicles vehicle on vehicle.id = contract.vehicle_id
  where contract.organization_id = target_organization_id
  order by contract.created_at desc;
end;
$$;

create or replace function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare c public.rental_contracts; fee public.contract_fees; interval_value integer; interval_unit public.billing_interval_unit; period_start date; next_start date; period_end date; inserted_invoice_id uuid; inserted_amount numeric; created_count integer := 0;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  for c in select * from public.rental_contracts where organization_id = target_organization_id and status = 'active' loop
    interval_value := case c.billing_frequency when 'daily' then 1 when 'weekly' then 1 when 'fortnightly' then 2 when 'monthly' then 1 else c.billing_custom_interval end;
    interval_unit := case c.billing_frequency when 'daily' then 'day'::public.billing_interval_unit when 'weekly' then 'week'::public.billing_interval_unit when 'fortnightly' then 'week'::public.billing_interval_unit when 'monthly' then 'month'::public.billing_interval_unit else c.billing_custom_unit end;
    period_start := c.starts_on;
    while period_start <= least(generate_until, c.expected_return_on) loop
      next_start := case interval_unit when 'day' then period_start + interval_value when 'week' then period_start + (interval_value * 7) else (period_start + make_interval(months => interval_value))::date end;
      period_end := least(next_start - 1, c.expected_return_on);
      inserted_amount := round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2);
      inserted_invoice_id := null;
      insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.tenant_id, c.id, period_start, period_end, period_end, inserted_amount, inserted_amount, 'Locação ' || to_char(period_start, 'DD/MM/YYYY') || ' a ' || to_char(period_end, 'DD/MM/YYYY'))
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
      returning id into inserted_invoice_id;
      if inserted_invoice_id is not null then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, inserted_invoice_id, 'base', 'Período de locação', (period_end - period_start + 1), c.daily_rate, inserted_amount);
        for fee in select * from public.contract_fees where contract_id = c.id loop
          if fee.recurrence = 'recurring' or period_start = c.starts_on then
            insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
            values (target_organization_id, inserted_invoice_id, 'fee', fee.name, 1, fee.amount, fee.amount);
          end if;
        end loop;
        select refreshed.amount_due into inserted_amount from public.refresh_invoice_totals(inserted_invoice_id) as refreshed;
        perform public.enqueue_tenant_event(target_organization_id, c.tenant_id, 'invoice_created',
          jsonb_build_object('tenant_name', (select full_name from public.tenants where id = c.tenant_id), 'amount', inserted_amount, 'due_on', to_char(period_end, 'YYYY-MM-DD')),
          'invoice:' || inserted_invoice_id || ':created');
        created_count := created_count + 1;
      end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return created_count;
end;
$$;

revoke all on function public.set_contract_deposit(uuid, uuid, numeric) from public;
revoke all on function public.charge_contract_deposit(uuid, uuid, date, text) from public;
revoke all on function public.settle_contract_deposit(uuid, uuid, public.deposit_status, text) from public;
revoke all on function public.add_contract_fee(uuid, uuid, text, numeric, text) from public;
revoke all on function public.remove_contract_fee(uuid, uuid) from public;
revoke all on function public.list_contract_fees(uuid, uuid) from public;

grant execute on function public.set_contract_deposit(uuid, uuid, numeric) to authenticated;
grant execute on function public.charge_contract_deposit(uuid, uuid, date, text) to authenticated;
grant execute on function public.settle_contract_deposit(uuid, uuid, public.deposit_status, text) to authenticated;
grant execute on function public.add_contract_fee(uuid, uuid, text, numeric, text) to authenticated;
grant execute on function public.remove_contract_fee(uuid, uuid) to authenticated;
grant execute on function public.list_contract_fees(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150004_contract_renewals.sql — contract renewals
-- ----------------------------------------------------------------------------

-- Prorrogação dedicada do contrato, com histórico.

create table if not exists public.contract_renewals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  previous_return_on date not null,
  new_return_on date not null,
  previous_daily_rate numeric(12,2) not null,
  new_daily_rate numeric(12,2) not null,
  renewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contract_renewals_contract_idx on public.contract_renewals (contract_id, created_at desc);

alter table public.contract_renewals enable row level security;

drop policy if exists contract_renewals_select_member on public.contract_renewals;
create policy contract_renewals_select_member on public.contract_renewals
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.extend_rental_contract(target_organization_id uuid, target_contract_id uuid, new_return_on date, new_daily_rate numeric default null)
returns public.rental_contracts
language plpgsql security definer set search_path = public
as $$
declare contract_row public.rental_contracts; updated public.rental_contracts; effective_rate numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  select * into contract_row from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id;
  if contract_row.id is null then raise exception 'contract not found'; end if;
  if contract_row.status <> 'active' then raise exception 'only active contracts can be renewed'; end if;
  if new_return_on <= contract_row.expected_return_on then raise exception 'new return date must be after the current one'; end if;
  effective_rate := coalesce(new_daily_rate, contract_row.daily_rate);
  if effective_rate <= 0 then raise exception 'daily rate must be positive'; end if;
  insert into public.contract_renewals (organization_id, contract_id, previous_return_on, new_return_on, previous_daily_rate, new_daily_rate, renewed_by)
  values (target_organization_id, target_contract_id, contract_row.expected_return_on, new_return_on, contract_row.daily_rate, effective_rate, auth.uid());
  update public.rental_contracts
  set expected_return_on = new_return_on, daily_rate = effective_rate, updated_at = now()
  where id = target_contract_id
  returning * into updated;
  return updated;
end;
$$;

create or replace function public.list_contract_renewals(target_organization_id uuid, target_contract_id uuid)
returns setof public.contract_renewals
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select * from public.contract_renewals where contract_id = target_contract_id and organization_id = target_organization_id order by created_at desc;
end;
$$;

revoke all on function public.extend_rental_contract(uuid, uuid, date, numeric) from public;
revoke all on function public.list_contract_renewals(uuid, uuid) from public;
grant execute on function public.extend_rental_contract(uuid, uuid, date, numeric) to authenticated;
grant execute on function public.list_contract_renewals(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150005_contract_return_settlement.sql — contract return settlement
-- ----------------------------------------------------------------------------

-- Encerramento com acerto: diária excedente e avarias da devolução geram fatura idempotente.

create or replace function public.settle_contract_return(
  target_organization_id uuid,
  target_contract_id uuid,
  target_actual_return_on date,
  settlement_due_on date default null
)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare contract_row public.rental_contracts; late_days integer; damage_total numeric; settlement public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  select * into contract_row from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id;
  if contract_row.id is null then raise exception 'contract not found'; end if;
  if contract_row.status <> 'active' then raise exception 'contract is not active'; end if;
  if target_actual_return_on < contract_row.starts_on then raise exception 'invalid return date'; end if;

  late_days := greatest(target_actual_return_on - contract_row.expected_return_on, 0);
  select coalesce(sum(damage.estimated_cost), 0) into damage_total
  from public.contract_inspections inspection
  join public.contract_inspection_damages damage on damage.inspection_id = inspection.id
  where inspection.contract_id = contract_row.id and inspection.type = 'return';

  update public.rental_contracts set status = 'completed', actual_return_on = target_actual_return_on, updated_at = now() where id = contract_row.id;
  update public.vehicles set status = 'available' where id = contract_row.vehicle_id and organization_id = target_organization_id and status = 'rented';

  settlement := null;
  if late_days > 0 or damage_total > 0 then
    insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
    values (target_organization_id, contract_row.tenant_id, contract_row.id, target_actual_return_on, target_actual_return_on, coalesce(settlement_due_on, target_actual_return_on), 0, 0, 'Acerto de devolução')
    on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
    returning * into settlement;
    if settlement.id is not null then
      if late_days > 0 then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, settlement.id, 'extra_daily', 'Diária excedente (' || late_days || ' dia(s))', late_days, contract_row.daily_rate, round(late_days * contract_row.daily_rate, 2));
      end if;
      if damage_total > 0 then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, settlement.id, 'damage', 'Avarias da devolução', 1, round(damage_total, 2), round(damage_total, 2));
      end if;
      settlement := public.refresh_invoice_totals(settlement.id);
      perform public.enqueue_tenant_event(target_organization_id, contract_row.tenant_id, 'invoice_created',
        jsonb_build_object('tenant_name', (select full_name from public.tenants where id = contract_row.tenant_id), 'amount', settlement.amount_due, 'due_on', to_char(settlement.due_on, 'YYYY-MM-DD')),
        'invoice:' || settlement.id || ':created');
    end if;
  end if;
  return settlement;
end;
$$;

revoke all on function public.settle_contract_return(uuid, uuid, date, date) from public;
grant execute on function public.settle_contract_return(uuid, uuid, date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150006_audit_logs.sql — audit logs
-- ----------------------------------------------------------------------------

-- Auditoria imutável de ações administrativas e operacionais.
-- A tabela não possui políticas de update/delete; gravação apenas via função SECURITY DEFINER.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_manager on public.audit_logs;
create policy audit_logs_select_manager on public.audit_logs
  for select to authenticated
  using (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists audit_logs_select_platform_administrator on public.audit_logs;
create policy audit_logs_select_platform_administrator on public.audit_logs
  for select to authenticated
  using (public.is_platform_administrator());

create or replace function public.record_audit_event(
  target_organization_id uuid,
  audit_action text,
  audit_entity_type text,
  audit_entity_id uuid,
  audit_summary text,
  audit_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare actor_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_organization_id is not null and not public.is_active_organization_member(target_organization_id) and not public.is_platform_administrator() then
    raise exception 'not allowed to record audit for this organization';
  end if;
  select lower(email) into actor_email from auth.users where id = auth.uid();
  insert into public.audit_logs (organization_id, actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (target_organization_id, auth.uid(), actor_email, btrim(audit_action), btrim(audit_entity_type), audit_entity_id, btrim(audit_summary), coalesce(audit_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.list_audit_logs(target_organization_id uuid, filter_limit integer default 100)
returns table (id uuid, actor_email text, action text, entity_type text, entity_id uuid, summary text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select log.id, log.actor_email, log.action, log.entity_type, log.entity_id, log.summary, log.metadata, log.created_at
    from public.audit_logs log
    where log.organization_id = target_organization_id
    order by log.created_at desc
    limit greatest(coalesce(filter_limit, 100), 1);
end;
$$;

revoke all on function public.record_audit_event(uuid, text, text, uuid, text, jsonb) from public;
revoke all on function public.list_audit_logs(uuid, integer) from public;
grant execute on function public.record_audit_event(uuid, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.list_audit_logs(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150007_organization_selection.sql — organization selection
-- ----------------------------------------------------------------------------

-- Seleção de organização ativa quando o usuário participa de mais de uma.

create table if not exists public.user_organization_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_organization_id uuid references public.organizations(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_organization_preferences enable row level security;

drop policy if exists user_organization_preferences_select_own on public.user_organization_preferences;
create policy user_organization_preferences_select_own on public.user_organization_preferences
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.set_active_organization(target_organization_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  insert into public.user_organization_preferences (user_id, active_organization_id, updated_at)
  values (auth.uid(), target_organization_id, now())
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id, updated_at = now();
end;
$$;

-- A organização escolhida passa a ser a primeira da lista; as telas usam find(status='active').
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
  left join public.user_organization_preferences pref on pref.user_id = m.user_id
  where m.user_id = auth.uid()
  order by (o.id = pref.active_organization_id) desc nulls last, o.created_at desc;
$$;

revoke all on function public.set_active_organization(uuid) from public;
grant execute on function public.set_active_organization(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150008_tenant_privacy.sql — tenant privacy
-- ----------------------------------------------------------------------------

-- LGPD: exportação de dados do titular e anonimização com retenção de registros financeiros.

create or replace function public.export_tenant_data(target_organization_id uuid, target_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  select jsonb_build_object(
    'tenant', (select to_jsonb(t) from (select id, full_name, document_number, email, phone, status, created_at from public.tenants where id = target_tenant_id) t),
    'address', coalesce((select jsonb_agg(to_jsonb(a)) from (select * from public.tenant_addresses where tenant_id = target_tenant_id) a), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d)) from (select id, type, name, identifier, category, expires_on, created_at from public.tenant_documents where tenant_id = target_tenant_id) d), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(to_jsonb(c)) from (select id, vehicle_id, starts_on, expected_return_on, actual_return_on, daily_rate, status from public.rental_contracts where tenant_id = target_tenant_id) c), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i)) from (select id, contract_id, due_on, amount_due, amount_paid, status, description from public.invoices where tenant_id = target_tenant_id) i), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from (select pay.id, pay.invoice_id, pay.paid_on, pay.amount, pay.method, pay.note from public.payments pay join public.invoices inv on inv.id = pay.invoice_id where inv.tenant_id = target_tenant_id) p), '[]'::jsonb),
    'communications', coalesce((select jsonb_agg(to_jsonb(m)) from (select id, channel, event, subject, body, status, created_at from public.messages where tenant_id = target_tenant_id) m), '[]'::jsonb),
    'preferences', coalesce((select to_jsonb(pref) from (select email_opt_in, whatsapp_opt_in, consent_at from public.tenant_contact_preferences where tenant_id = target_tenant_id) pref), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.anonymize_tenant(target_organization_id uuid, target_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  delete from public.tenant_documents where tenant_id = target_tenant_id;
  delete from public.tenant_addresses where tenant_id = target_tenant_id;
  delete from public.tenant_contact_preferences where tenant_id = target_tenant_id;
  update public.messages set recipient = 'anonimizado', subject = null, body = null where tenant_id = target_tenant_id;
  update public.tenants set full_name = 'Titular anonimizado', document_number = null, email = null, phone = null, status = 'inactive' where id = target_tenant_id;
  perform public.record_audit_event(target_organization_id, 'tenant.anonymized', 'tenant', target_tenant_id, 'Dados pessoais do locatário anonimizados');
end;
$$;

revoke all on function public.export_tenant_data(uuid, uuid) from public;
revoke all on function public.anonymize_tenant(uuid, uuid) from public;
grant execute on function public.export_tenant_data(uuid, uuid) to authenticated;
grant execute on function public.anonymize_tenant(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150009_contract_signatures.sql — contract signatures
-- ----------------------------------------------------------------------------

-- Assinatura do contrato de locação (partes) para o documento em PDF.

create type public.contract_signer_role as enum ('tenant', 'company');

create table if not exists public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  signer_role public.contract_signer_role not null,
  signer_name text not null,
  signer_document text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (contract_id, signer_role)
);

create index if not exists contract_signatures_contract_idx on public.contract_signatures (contract_id);

alter table public.contract_signatures enable row level security;

drop policy if exists contract_signatures_select_member on public.contract_signatures;
create policy contract_signatures_select_member on public.contract_signatures
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.sign_rental_contract(target_organization_id uuid, target_contract_id uuid, signer_role public.contract_signer_role, signer_name text, signer_document text)
returns public.contract_signatures
language plpgsql security definer set search_path = public
as $$
declare created public.contract_signatures;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if coalesce(btrim(signer_name), '') = '' then raise exception 'signer name is required'; end if;
  if not exists (select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id) then raise exception 'contract not found'; end if;
  insert into public.contract_signatures (organization_id, contract_id, signer_role, signer_name, signer_document, signed_at)
  values (target_organization_id, target_contract_id, signer_role, btrim(signer_name), nullif(btrim(signer_document), ''), now())
  on conflict (contract_id, signer_role) do update set signer_name = excluded.signer_name, signer_document = excluded.signer_document, signed_at = now()
  returning * into created;
  perform public.record_audit_event(target_organization_id, 'contract.signed', 'rental_contract', target_contract_id, 'Contrato assinado por ' || signer_role::text);
  return created;
end;
$$;

create or replace function public.list_contract_signatures(target_organization_id uuid, target_contract_id uuid)
returns setof public.contract_signatures
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select * from public.contract_signatures where contract_id = target_contract_id and organization_id = target_organization_id order by signer_role;
end;
$$;

revoke all on function public.sign_rental_contract(uuid, uuid, public.contract_signer_role, text, text) from public;
revoke all on function public.list_contract_signatures(uuid, uuid) from public;
grant execute on function public.sign_rental_contract(uuid, uuid, public.contract_signer_role, text, text) to authenticated;
grant execute on function public.list_contract_signatures(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150010_organization_api_tokens.sql — organization api tokens
-- ----------------------------------------------------------------------------

-- Tokens de API por organização (integração externa, ex.: n8n) e configuração de entrega.
-- O valor bruto do token nunca é armazenado: apenas o hash SHA-256 calculado no servidor.

create table if not exists public.organization_api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_api_tokens_org_idx on public.organization_api_tokens (organization_id, created_at desc);

alter table public.organization_api_tokens enable row level security;

drop policy if exists organization_api_tokens_select_manager on public.organization_api_tokens;
create policy organization_api_tokens_select_manager on public.organization_api_tokens
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create table if not exists public.organization_messaging_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  whatsapp_delivery text not null default 'sga',
  updated_at timestamptz not null default now(),
  constraint organization_messaging_settings_delivery_check check (whatsapp_delivery in ('sga', 'n8n'))
);

alter table public.organization_messaging_settings enable row level security;

drop policy if exists organization_messaging_settings_select_member on public.organization_messaging_settings;
create policy organization_messaging_settings_select_member on public.organization_messaging_settings
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.create_organization_api_token(
  target_organization_id uuid,
  token_name text,
  token_hash text,
  token_prefix_value text,
  token_scopes text[],
  token_expires_at timestamptz default null
)
returns table (id uuid, name text, token_prefix text, scopes text[], expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare created public.organization_api_tokens;
declare allowed text[] := array['messaging:send', 'messaging:read', 'invoices:read', 'tenants:read', 'contracts:read'];
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(token_name), '') = '' then raise exception 'token name is required'; end if;
  if coalesce(btrim(token_hash), '') = '' then raise exception 'token hash is required'; end if;
  if array_length(token_scopes, 1) is null or not (token_scopes <@ allowed) then raise exception 'invalid scopes'; end if;
  if token_expires_at is not null and token_expires_at <= now() then raise exception 'expiration must be in the future'; end if;
  insert into public.organization_api_tokens (organization_id, name, token_hash, token_prefix, scopes, created_by, expires_at)
  values (target_organization_id, btrim(token_name), btrim(token_hash), btrim(token_prefix_value), token_scopes, auth.uid(), token_expires_at)
  returning * into created;
  perform public.record_audit_event(target_organization_id, 'api_token.created', 'organization_api_token', created.id, 'Token de API criado: ' || created.name);
  return query select created.id, created.name, created.token_prefix, created.scopes, created.expires_at, created.created_at;
end;
$$;

create or replace function public.list_organization_api_tokens(target_organization_id uuid)
returns table (id uuid, name text, token_prefix text, scopes text[], last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select token.id, token.name, token.token_prefix, token.scopes, token.last_used_at, token.expires_at, token.revoked_at, token.created_at
    from public.organization_api_tokens token
    where token.organization_id = target_organization_id
    order by token.created_at desc;
end;
$$;

create or replace function public.revoke_organization_api_token(target_organization_id uuid, target_token_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare token_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  update public.organization_api_tokens set revoked_at = now()
  where id = target_token_id and organization_id = target_organization_id and revoked_at is null
  returning name into token_name;
  if token_name is null then raise exception 'token not found'; end if;
  perform public.record_audit_event(target_organization_id, 'api_token.revoked', 'organization_api_token', target_token_id, 'Token de API revogado: ' || token_name);
end;
$$;

create or replace function public.resolve_organization_api_token(presented_token_hash text)
returns table (token_id uuid, organization_id uuid, scopes text[])
language plpgsql security definer set search_path = public
as $$
declare token_row public.organization_api_tokens; organization_state public.organization_status;
begin
  select * into token_row from public.organization_api_tokens where token_hash = presented_token_hash limit 1;
  if token_row.id is null then raise exception 'invalid token'; end if;
  if token_row.revoked_at is not null then raise exception 'token revoked'; end if;
  if token_row.expires_at is not null and token_row.expires_at <= now() then raise exception 'token expired'; end if;
  select status into organization_state from public.organizations where id = token_row.organization_id;
  if organization_state <> 'active' then raise exception 'organization is not active'; end if;
  update public.organization_api_tokens set last_used_at = now() where id = token_row.id;
  return query select token_row.id, token_row.organization_id, token_row.scopes;
end;
$$;

create or replace function public.get_organization_messaging_settings(target_organization_id uuid)
returns table (whatsapp_delivery text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select coalesce(settings.whatsapp_delivery, 'sga') from public.organization_messaging_settings settings where settings.organization_id = target_organization_id
  union all select 'sga' where not exists (select 1 from public.organization_messaging_settings where organization_id = target_organization_id);
end;
$$;

create or replace function public.set_organization_messaging_settings(target_organization_id uuid, delivery text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if delivery not in ('sga', 'n8n') then raise exception 'invalid delivery provider'; end if;
  insert into public.organization_messaging_settings (organization_id, whatsapp_delivery, updated_at)
  values (target_organization_id, delivery, now())
  on conflict (organization_id) do update set whatsapp_delivery = excluded.whatsapp_delivery, updated_at = now();
end;
$$;

revoke all on function public.create_organization_api_token(uuid, text, text, text, text[], timestamptz) from public;
revoke all on function public.list_organization_api_tokens(uuid) from public;
revoke all on function public.revoke_organization_api_token(uuid, uuid) from public;
revoke all on function public.resolve_organization_api_token(text) from public;
revoke all on function public.get_organization_messaging_settings(uuid) from public;
revoke all on function public.set_organization_messaging_settings(uuid, text) from public;

grant execute on function public.create_organization_api_token(uuid, text, text, text, text[], timestamptz) to authenticated;
grant execute on function public.list_organization_api_tokens(uuid) to authenticated;
grant execute on function public.revoke_organization_api_token(uuid, uuid) to authenticated;
grant execute on function public.resolve_organization_api_token(text) to anon, authenticated;
grant execute on function public.get_organization_messaging_settings(uuid) to authenticated;
grant execute on function public.set_organization_messaging_settings(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150011_reconcile_audit_logs.sql — reconcile audit logs
-- ----------------------------------------------------------------------------

-- Reconcilia audit_logs com o formato esperado por record_audit_event/list_audit_logs.
-- A tabela já existia desde 202609120002 com actor_user_id e sem actor_email/summary.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_user_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_id') then
    alter table public.audit_logs rename column actor_user_id to actor_id;
  end if;
end $$;

alter table public.audit_logs add column if not exists actor_email text;
alter table public.audit_logs add column if not exists summary text not null default '';
alter table public.audit_logs alter column organization_id drop not null;

drop policy if exists audit_logs_select_member on public.audit_logs;

-- ----------------------------------------------------------------------------
-- 202609150012_whatsapp_only_billings.sql — whatsapp only billings
-- ----------------------------------------------------------------------------

-- Mensagens de cobrança passam a ser somente WhatsApp (Meta Cloud API).
-- O e-mail (Resend) fica restrito a convites de equipe e e-mails de autenticação.
-- O parâmetro de canais tem padrão WhatsApp, permitindo reuso futuro sem quebrar chamadas.

drop function if exists public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text);

create or replace function public.enqueue_tenant_event(
  target_organization_id uuid,
  target_tenant_id uuid,
  message_event public.message_event,
  message_payload jsonb,
  dedupe_base text,
  message_channels public.message_channel[] default array['whatsapp']::public.message_channel[]
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare tenant_record public.tenants;
declare current_channel public.message_channel;
declare recipient text;
declare created_count integer := 0;
declare created_message public.messages;
begin
  select * into tenant_record from public.tenants where id = target_tenant_id and organization_id = target_organization_id;
  if tenant_record.id is null then return 0; end if;
  foreach current_channel in array message_channels loop
    recipient := case when current_channel = 'email' then tenant_record.email else tenant_record.phone end;
    if recipient is null or btrim(recipient) = '' then continue; end if;
    created_message := public.enqueue_message(target_organization_id, target_tenant_id, current_channel, message_event, recipient, message_payload, dedupe_base || ':' || current_channel);
    if created_message.id is not null then created_count := created_count + 1; end if;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text, public.message_channel[]) from public;

-- ----------------------------------------------------------------------------
-- 202609150013_meta_template_name_per_org.sql — meta template name per org
-- ----------------------------------------------------------------------------

-- O nome do template Meta deve ser único por organização, não globalmente.
-- Antes, um nome usado por outra organização bloqueava a criação.

alter table public.meta_whatsapp_templates drop constraint if exists meta_whatsapp_templates_name_key;
alter table public.meta_whatsapp_templates drop constraint if exists meta_whatsapp_templates_org_name_key;
alter table public.meta_whatsapp_templates add constraint meta_whatsapp_templates_org_name_key unique nulls not distinct (organization_id, name);

create or replace function public.create_organization_meta_whatsapp_template(target_organization_id uuid, template_name text, template_category text, template_language text, template_body text, template_examples jsonb)
returns public.meta_whatsapp_templates language plpgsql security definer set search_path = public as $$
declare saved public.meta_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if template_name !~ '^[a-z][a-z0-9_]{2,511}$' then raise exception 'template name must use lowercase letters, numbers and underscores'; end if;
  if template_category not in ('UTILITY', 'MARKETING', 'AUTHENTICATION') then raise exception 'invalid template category'; end if;
  if char_length(trim(template_body)) not between 1 and 1024 then raise exception 'template body must have 1 to 1024 characters'; end if;
  if jsonb_typeof(coalesce(template_examples, '[]'::jsonb)) <> 'array' then raise exception 'invalid examples'; end if;
  if exists (select 1 from public.meta_whatsapp_templates where organization_id = target_organization_id and name = trim(template_name)) then
    raise exception 'a template with this name already exists for this organization';
  end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609150014_fix_meta_template_regex.sql — fix meta template regex
-- ----------------------------------------------------------------------------

-- O regex anterior usava {2,511}, acima do limite de repetição do Postgres (255),
-- o que fazia a função falhar em toda criação com "invalid regular expression".
-- Aqui a validação usa regex simples + checagem de comprimento.

create or replace function public.create_organization_meta_whatsapp_template(target_organization_id uuid, template_name text, template_category text, template_language text, template_body text, template_examples jsonb)
returns public.meta_whatsapp_templates language plpgsql security definer set search_path = public as $$
declare saved public.meta_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if trim(template_name) !~ '^[a-z][a-z0-9_]*$' or char_length(trim(template_name)) not between 3 and 512 then
    raise exception 'template name must use lowercase letters, numbers and underscores';
  end if;
  if template_category not in ('UTILITY', 'MARKETING', 'AUTHENTICATION') then raise exception 'invalid template category'; end if;
  if char_length(trim(template_language)) not between 2 and 20 then raise exception 'invalid template language'; end if;
  if char_length(trim(template_body)) not between 1 and 1024 then raise exception 'template body must have 1 to 1024 characters'; end if;
  if jsonb_typeof(coalesce(template_examples, '[]'::jsonb)) <> 'array' then raise exception 'invalid examples'; end if;
  if exists (select 1 from public.meta_whatsapp_templates where organization_id = target_organization_id and name = trim(template_name)) then
    raise exception 'a template with this name already exists for this organization';
  end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 202609160015_zernio_whatsapp.sql — zernio whatsapp
-- ----------------------------------------------------------------------------

-- Integração do WhatsApp via Zernio, que substitui a integração direta com a Meta Cloud API.
--
-- Este arquivo é a fonte única da mudança e é idempotente de propósito: cria o que falta
-- com `if not exists`, remove o que sobrou com `if exists`, e redefine funções com
-- `create or replace`. Assim ele pode ser reaplicado com segurança depois de um rollback
-- parcial — o que um arquivo dividido em três não garantiria, porque o runner marca cada
-- arquivo pelo nome e uma falha no meio deixaria o histórico inconsistente.

create table if not exists public.organization_zernio_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  account_id text not null check (char_length(btrim(account_id)) between 1 and 100),
  api_key_ciphertext text not null check (char_length(api_key_ciphertext) > 20),
  display_name text check (char_length(btrim(display_name)) between 1 and 200),
  -- Identificador do perfil na Zernio. Um perfil agrupa contas; cada perfil comporta no
  -- máximo uma conta de WhatsApp, então conectar um segundo número exige outro perfil.
  profile_id text check (char_length(btrim(profile_id)) between 1 and 100),
  -- Estado do webhook. A Zernio assina cada entrega com um secret escolhido por quem
  -- registra o endpoint, e cada organização registra o seu, então o secret é por
  -- organização e fica cifrado aqui.
  webhook_id text check (char_length(btrim(webhook_id)) between 1 and 100),
  webhook_secret_ciphertext text check (char_length(webhook_secret_ciphertext) > 20),
  webhook_events text[] not null default array[]::text[],
  webhook_registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- `create table if not exists` é um no-op quando a tabela já existe, então as colunas
-- precisam ser garantidas à parte. Sem isto, reaplicar o arquivo sobre um banco que já
-- tinha a versão anterior da tabela deixaria as colunas novas de fora, em silêncio.
alter table public.organization_zernio_connections add column if not exists profile_id text check (char_length(btrim(profile_id)) between 1 and 100);
alter table public.organization_zernio_connections add column if not exists webhook_id text check (char_length(btrim(webhook_id)) between 1 and 100);
alter table public.organization_zernio_connections add column if not exists webhook_secret_ciphertext text check (char_length(webhook_secret_ciphertext) > 20);
alter table public.organization_zernio_connections add column if not exists webhook_events text[] not null default array[]::text[];
alter table public.organization_zernio_connections add column if not exists webhook_registered_at timestamptz;

drop trigger if exists organization_zernio_connections_set_updated_at on public.organization_zernio_connections;
create trigger organization_zernio_connections_set_updated_at before update on public.organization_zernio_connections for each row execute function public.set_updated_at();
alter table public.organization_zernio_connections enable row level security;
drop policy if exists organization_zernio_connections_no_client_access on public.organization_zernio_connections;
create policy organization_zernio_connections_no_client_access on public.organization_zernio_connections for select to authenticated using (false);

create table if not exists public.zernio_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  body text not null,
  scheduled_at time,
  status text not null default 'local' check (status in ('local','pending','approved','rejected','paused','disabled','unknown')),
  zernio_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  category text not null default 'UTILITY' check (category in ('UTILITY','MARKETING','AUTHENTICATION')),
  language text not null default 'pt_BR' check (char_length(btrim(language)) between 2 and 16),
  body_examples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zernio_whatsapp_templates_organization_code_key unique nulls not distinct (organization_id, code)
);
drop trigger if exists zernio_whatsapp_templates_set_updated_at on public.zernio_whatsapp_templates;
create trigger zernio_whatsapp_templates_set_updated_at before update on public.zernio_whatsapp_templates for each row execute function public.set_updated_at();
create index if not exists zernio_whatsapp_templates_organization_idx on public.zernio_whatsapp_templates (organization_id, scheduled_at);
alter table public.zernio_whatsapp_templates enable row level security;
drop policy if exists zernio_whatsapp_templates_read_organization_member on public.zernio_whatsapp_templates;
create policy zernio_whatsapp_templates_read_organization_member on public.zernio_whatsapp_templates for select to authenticated using (organization_id is not null and public.is_active_organization_member(organization_id));

-- Tentativas de conectar um número. O nonce é o que identifica a tentativa no callback:
-- a Zernio redireciona de volta, e nenhum parâmetro da query pode ser considerado confiável.
create table if not exists public.zernio_connect_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nonce text not null unique,
  profile_id text,
  redirect_url text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  completed_at timestamptz
);
create index if not exists zernio_connect_sessions_organization_idx on public.zernio_connect_sessions (organization_id, created_at desc);
alter table public.zernio_connect_sessions enable row level security;
drop policy if exists zernio_connect_sessions_no_client_access on public.zernio_connect_sessions;
create policy zernio_connect_sessions_no_client_access on public.zernio_connect_sessions for select to authenticated using (false);

-- Respostas recebidas do WhatsApp. Não vai em message_events: essa tabela exige
-- message_id com FK para messages, e uma mensagem recebida não tem linha lá.
create table if not exists public.zernio_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id text not null,
  zernio_message_id text not null,
  platform_message_id text,
  conversation_id text,
  sender text,
  text text,
  attachments jsonb not null default '[]'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint zernio_inbound_messages_unique unique (organization_id, zernio_message_id)
);
create index if not exists zernio_inbound_messages_organization_idx on public.zernio_inbound_messages (organization_id, received_at desc);
alter table public.zernio_inbound_messages enable row level security;
drop policy if exists zernio_inbound_messages_read_organization_member on public.zernio_inbound_messages;
create policy zernio_inbound_messages_read_organization_member on public.zernio_inbound_messages for select to authenticated using (public.is_active_organization_member(organization_id));

-- RLS é bloqueio, não permitir: o api_key_ciphertext nunca sai do servidor. A interface
-- recebe status por funções SECURITY DEFINER que devolvem apenas identificadores públicos.
create or replace function public.ensure_organization_zernio_whatsapp_templates(target_organization_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  insert into public.zernio_whatsapp_templates (organization_id, code, name, body, scheduled_at)
  select target_organization_id, source.code, 'sga_' || substr(replace(target_organization_id::text, '-', ''), 1, 12) || '_' || source.code, source.body, source.scheduled_at
  from public.zernio_whatsapp_templates source where source.organization_id is null
  on conflict (organization_id, code) do nothing;
end;
$$;
create or replace function public.list_organization_zernio_whatsapp_templates(target_organization_id uuid)
returns table (id uuid, code text, name text, body text, scheduled_at time, status text, rejection_reason text, last_synced_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select t.id, t.code, t.name, t.body, t.scheduled_at, t.status, t.rejection_reason, t.last_synced_at from public.zernio_whatsapp_templates t where t.organization_id = target_organization_id order by t.scheduled_at;
end;
$$;
create or replace function public.create_organization_zernio_whatsapp_template(target_organization_id uuid, template_name text, template_body text, template_category text, template_language text, template_examples jsonb)
returns public.zernio_whatsapp_templates
language plpgsql security definer set search_path = public as $$
declare saved public.zernio_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if not public.valid_template_name(template_name) then raise exception 'invalid template name'; end if;
  if not public.valid_template_body(template_body) then raise exception 'invalid template body'; end if;
  insert into public.zernio_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
-- `create or replace` não consegue alterar a assinatura de retorno (os OUT parameters).
-- Esta função ganhou `profile_id`, então precisa sair antes de voltar.
drop function if exists public.get_organization_zernio_connection_status(uuid);
create or replace function public.get_organization_zernio_connection_status(target_organization_id uuid)
returns table (account_id text, display_name text, configured boolean, profile_id text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query select c.account_id, c.display_name, true, c.profile_id from public.organization_zernio_connections c where c.organization_id = target_organization_id;
end;
$$;
create or replace function public.get_organization_zernio_webhook_status(target_organization_id uuid)
returns table (webhook_id text, webhook_events text[], registered_at timestamptz, configured boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query select c.webhook_id, c.webhook_events, c.webhook_registered_at, c.webhook_secret_ciphertext is not null from public.organization_zernio_connections c where c.organization_id = target_organization_id;
end;
$$;
revoke all on function public.ensure_organization_zernio_whatsapp_templates(uuid), public.list_organization_zernio_whatsapp_templates(uuid), public.create_organization_zernio_whatsapp_template(uuid, text, text, text, text, jsonb), public.get_organization_zernio_connection_status(uuid), public.get_organization_zernio_webhook_status(uuid) from public;
grant execute on function public.ensure_organization_zernio_whatsapp_templates(uuid), public.list_organization_zernio_whatsapp_templates(uuid), public.create_organization_zernio_whatsapp_template(uuid, text, text, text, text, jsonb), public.get_organization_zernio_connection_status(uuid), public.get_organization_zernio_webhook_status(uuid) to authenticated;

alter table public.organization_messaging_settings drop constraint if exists organization_messaging_settings_delivery_check;
alter table public.organization_messaging_settings add constraint organization_messaging_settings_delivery_check check (whatsapp_delivery in ('sga', 'n8n', 'zernio'));
create or replace function public.set_organization_messaging_settings(target_organization_id uuid, delivery text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if delivery not in ('sga', 'n8n', 'zernio') then raise exception 'invalid delivery provider'; end if;
  insert into public.organization_messaging_settings (organization_id, whatsapp_delivery, updated_at)
  values (target_organization_id, delivery, now())
  on conflict (organization_id) do update set whatsapp_delivery = excluded.whatsapp_delivery, updated_at = now();
end;
$$;
revoke all on function public.set_organization_messaging_settings(uuid, text) from public;
grant execute on function public.set_organization_messaging_settings(uuid, text) to authenticated;

-- Migração dos dados da Meta para a Zernio. Precisa acontecer antes do drop, e o
-- `if exists` mantém o arquivo reaplicável num banco onde a Meta já foi removida.
do $$
begin
  if to_regclass('public.meta_whatsapp_templates') is not null then
    insert into public.zernio_whatsapp_templates (organization_id, code, name, body, scheduled_at, status, rejection_reason, category, language, body_examples)
    select organization_id, code, name, body, scheduled_at, status, rejection_reason, category, language, body_examples
    from public.meta_whatsapp_templates
    on conflict (organization_id, code) do nothing;
  end if;
end;
$$;

-- As credenciais da Meta eram cifradas com a derivação antiga da chave; com a chave nova
-- seriam indecifráveis de qualquer forma. São descartadas e cada organização informa a
-- própria API key da Zernio.
drop function if exists public.get_organization_whatsapp_connection_status(uuid);
drop function if exists public.list_organization_meta_whatsapp_templates(uuid);
drop function if exists public.ensure_organization_meta_whatsapp_templates(uuid);
drop function if exists public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb);
drop table if exists public.meta_whatsapp_templates;
drop table if exists public.organization_whatsapp_connections;
