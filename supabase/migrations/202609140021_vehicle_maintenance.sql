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
