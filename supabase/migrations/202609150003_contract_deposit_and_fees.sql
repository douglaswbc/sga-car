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
