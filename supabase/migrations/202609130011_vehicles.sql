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
