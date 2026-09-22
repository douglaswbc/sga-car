do $$ begin
  create type public.invoice_status as enum ('pending', 'paid', 'overdue', 'cancelled', 'reversed');
  create type public.payment_method as enum ('cash', 'pix', 'bank_transfer', 'credit_card', 'debit_card', 'other');
exception when duplicate_object then null;
end $$;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid references public.rental_contracts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  billing_period_starts_on date not null,
  billing_period_ends_on date not null check (billing_period_ends_on >= billing_period_starts_on),
  due_on date not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  additional_amount numeric(12,2) not null default 0 check (additional_amount >= 0),
  amount_due numeric(12,2) not null check (amount_due >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  status public.invoice_status not null default 'pending',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid <= amount_due)
);
create unique index invoices_contract_period_unique on public.invoices (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null;
create index invoices_organization_status_due_idx on public.invoices (organization_id, status, due_on);
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null,
  receipt_url text,
  note text,
  created_at timestamptz not null default now()
);
create index payments_organization_invoice_idx on public.payments (organization_id, invoice_id, paid_on desc);

alter table public.invoices enable row level security;
alter table public.payments enable row level security;
create policy invoices_select_member on public.invoices for select to authenticated using (public.is_active_organization_member(organization_id));
create policy invoices_write_finance on public.invoices for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));
create policy payments_select_member on public.payments for select to authenticated using (public.is_active_organization_member(organization_id));
create policy payments_write_finance on public.payments for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));

create function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; period_start date; next_start date; period_end date; count_created integer := 0; interval_value integer; interval_unit public.billing_interval_unit;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  for c in select * from public.rental_contracts where organization_id = target_organization_id and status = 'active' loop
    interval_value := case c.billing_frequency when 'daily' then 1 when 'weekly' then 1 when 'fortnightly' then 2 when 'monthly' then 1 else c.billing_custom_interval end;
    interval_unit := case c.billing_frequency when 'daily' then 'day'::public.billing_interval_unit when 'weekly' then 'week'::public.billing_interval_unit when 'fortnightly' then 'week'::public.billing_interval_unit when 'monthly' then 'month'::public.billing_interval_unit else c.billing_custom_unit end;
    period_start := c.starts_on;
    while period_start <= least(generate_until, c.expected_return_on) loop
      next_start := case interval_unit when 'day' then period_start + interval_value when 'week' then period_start + (interval_value * 7) else (period_start + make_interval(months => interval_value))::date end;
      period_end := least(next_start - 1, c.expected_return_on);
      insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.id, c.tenant_id, period_start, period_end, period_end, round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2), round(((period_end - period_start + 1) * c.daily_rate)::numeric, 2), 'Cobrança de locação')
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing;
      if found then count_created := count_created + 1; end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return count_created;
end;
$$;

create function public.create_manual_invoice(target_organization_id uuid, target_tenant_id uuid, target_contract_id uuid, invoice_due_on date, invoice_amount numeric, invoice_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare created_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if invoice_amount <= 0 or not exists(select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'invalid invoice'; end if;
  if target_contract_id is not null and not exists(select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id and tenant_id = target_tenant_id) then raise exception 'invalid contract'; end if;
  insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, target_contract_id, target_tenant_id, invoice_due_on, invoice_due_on, invoice_due_on, invoice_amount, invoice_amount, nullif(trim(invoice_description), '')) returning * into created_invoice;
  return created_invoice;
end;
$$;

create function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note) values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), '')) returning * into created_payment;
  update public.invoices set amount_paid = new_paid, status = case when new_paid = amount_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end where id = target_invoice_id;
  return created_payment;
end;
$$;

create function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return query select i.id, i.contract_id, i.tenant_id, t.full_name, i.due_on, i.amount_due, i.amount_paid, i.status, i.description, i.created_at from public.invoices i join public.tenants t on t.id = i.tenant_id where i.organization_id = target_organization_id order by i.due_on asc, i.created_at desc;
end;
$$;

revoke all on function public.generate_contract_invoices(uuid, date), public.create_manual_invoice(uuid, uuid, uuid, date, numeric, text), public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text), public.list_invoices(uuid) from public;
grant execute on function public.generate_contract_invoices(uuid, date), public.create_manual_invoice(uuid, uuid, uuid, date, numeric, text), public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text), public.list_invoices(uuid) to authenticated;
