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
