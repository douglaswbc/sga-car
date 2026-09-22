create or replace function public.create_manual_invoice(target_organization_id uuid, target_tenant_id uuid, target_contract_id uuid, invoice_due_on date, invoice_amount numeric, invoice_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare created_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if invoice_amount <= 0 or not exists(select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'invalid invoice'; end if;
  if target_contract_id is not null and not exists(select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id and tenant_id = target_tenant_id) then raise exception 'invalid contract'; end if;
  insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
  values (target_organization_id, target_contract_id, target_tenant_id, invoice_due_on, invoice_due_on, invoice_due_on, invoice_amount, invoice_amount, nullif(trim(invoice_description), '')) returning * into created_invoice;
  perform public.enqueue_tenant_event(target_organization_id, target_tenant_id, 'invoice_created',
    jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target_tenant_id), 'amount', invoice_amount, 'due_on', to_char(invoice_due_on, 'YYYY-MM-DD'), 'description', coalesce(invoice_description, '')),
    'invoice:' || created_invoice.id || ':created');
  return created_invoice;
end;
$$;

create or replace function public.generate_contract_invoices(target_organization_id uuid, generate_until date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; period_start date; next_start date; period_end date; count_created integer := 0; interval_value integer; interval_unit public.billing_interval_unit; inserted_invoice_id uuid; inserted_amount numeric;
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
      insert into public.invoices (organization_id, contract_id, tenant_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
      values (target_organization_id, c.id, c.tenant_id, period_start, period_end, period_end, inserted_amount, inserted_amount, 'Cobrança de locação')
      on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
      returning id into inserted_invoice_id;
      if inserted_invoice_id is not null then
        count_created := count_created + 1;
        perform public.enqueue_tenant_event(target_organization_id, c.tenant_id, 'invoice_created',
          jsonb_build_object('tenant_name', (select full_name from public.tenants where id = c.tenant_id), 'amount', inserted_amount, 'due_on', to_char(period_end, 'YYYY-MM-DD'), 'description', 'Cobrança de locação'),
          'invoice:' || inserted_invoice_id || ':created');
      end if;
      period_start := next_start;
    end loop;
  end loop;
  update public.invoices set status = 'overdue' where organization_id = target_organization_id and status = 'pending' and due_on < current_date;
  return count_created;
end;
$$;

create or replace function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note) values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), '')) returning * into created_payment;
  update public.invoices set amount_paid = new_paid, status = case when new_paid = target_invoice.amount_due then 'paid' when target_invoice.due_on < current_date then 'overdue' else 'pending' end where id = target_invoice_id;
  perform public.enqueue_tenant_event(target_organization_id, target_invoice.tenant_id, 'payment_receipt',
    jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target_invoice.tenant_id), 'amount', payment_amount, 'paid_on', to_char(payment_paid_on, 'YYYY-MM-DD')),
    'payment:' || created_payment.id || ':receipt');
  return created_payment;
end;
$$;
