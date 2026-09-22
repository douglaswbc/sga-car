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
