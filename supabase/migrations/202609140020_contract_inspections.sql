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
