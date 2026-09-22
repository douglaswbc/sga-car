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
