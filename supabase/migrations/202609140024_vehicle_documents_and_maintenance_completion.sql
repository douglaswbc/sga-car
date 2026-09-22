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
