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
