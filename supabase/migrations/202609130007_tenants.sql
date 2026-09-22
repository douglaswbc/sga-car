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
