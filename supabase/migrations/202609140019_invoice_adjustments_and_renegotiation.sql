do $$ begin
  create type public.invoice_adjustment_type as enum ('discount', 'additional', 'fine', 'interest', 'renegotiation');
exception when duplicate_object then null;
end $$;

alter table public.invoices
  add column fine_amount numeric(12,2) not null default 0 check (fine_amount >= 0),
  add column interest_amount numeric(12,2) not null default 0 check (interest_amount >= 0);

create table public.invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  type public.invoice_adjustment_type not null,
  amount numeric(12,2) not null,
  description text not null,
  created_at timestamptz not null default now()
);
create index invoice_adjustments_invoice_idx on public.invoice_adjustments (invoice_id, created_at desc);
alter table public.invoice_adjustments enable row level security;
create policy invoice_adjustments_select_member on public.invoice_adjustments for select to authenticated using (public.is_active_organization_member(organization_id));
create policy invoice_adjustments_write_finance on public.invoice_adjustments for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'finance']::public.organization_role[]));

create function public.apply_invoice_adjustment(target_organization_id uuid, target_invoice_id uuid, adjustment_type public.invoice_adjustment_type, adjustment_amount numeric, adjustment_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; updated_invoice public.invoices; new_discount numeric; new_additional numeric; new_fine numeric; new_interest numeric; new_due numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if adjustment_type = 'renegotiation' or adjustment_amount <= 0 or nullif(trim(adjustment_description), '') is null then raise exception 'invalid adjustment'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') then raise exception 'invoice is not adjustable'; end if;
  new_discount := target_invoice.discount_amount + case when adjustment_type = 'discount' then adjustment_amount else 0 end;
  new_additional := target_invoice.additional_amount + case when adjustment_type = 'additional' then adjustment_amount else 0 end;
  new_fine := target_invoice.fine_amount + case when adjustment_type = 'fine' then adjustment_amount else 0 end;
  new_interest := target_invoice.interest_amount + case when adjustment_type = 'interest' then adjustment_amount else 0 end;
  new_due := target_invoice.subtotal - new_discount + new_additional + new_fine + new_interest;
  if new_due < target_invoice.amount_paid then raise exception 'adjustment cannot reduce the invoice below paid amount'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description) values (target_organization_id, target_invoice_id, adjustment_type, adjustment_amount, trim(adjustment_description));
  update public.invoices set discount_amount = new_discount, additional_amount = new_additional, fine_amount = new_fine, interest_amount = new_interest, amount_due = new_due, status = case when amount_paid = new_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end::public.invoice_status where id = target_invoice_id returning * into updated_invoice;
  return updated_invoice;
end;
$$;

create function public.renegotiate_invoice(target_organization_id uuid, target_invoice_id uuid, renegotiated_due_on date, renegotiated_amount numeric, renegotiation_description text)
returns public.invoices language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; updated_invoice public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  if renegotiated_amount <= 0 or nullif(trim(renegotiation_description), '') is null then raise exception 'invalid renegotiation'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or renegotiated_amount < target_invoice.amount_paid then raise exception 'invoice is not renegotiable'; end if;
  insert into public.invoice_adjustments (organization_id, invoice_id, type, amount, description) values (target_organization_id, target_invoice_id, 'renegotiation', renegotiated_amount - target_invoice.amount_due, trim(renegotiation_description));
  update public.invoices set subtotal = renegotiated_amount, discount_amount = 0, additional_amount = 0, fine_amount = 0, interest_amount = 0, amount_due = renegotiated_amount, due_on = renegotiated_due_on, status = case when amount_paid = renegotiated_amount then 'paid' else 'pending' end::public.invoice_status where id = target_invoice_id returning * into updated_invoice;
  return updated_invoice;
end;
$$;

drop function public.list_invoices(uuid);
create function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, subtotal numeric, discount_amount numeric, additional_amount numeric, fine_amount numeric, interest_amount numeric, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices as invoice set status = 'overdue' where invoice.organization_id = target_organization_id and invoice.status = 'pending' and invoice.due_on < current_date;
  return query select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name, invoice.due_on, invoice.subtotal, invoice.discount_amount, invoice.additional_amount, invoice.fine_amount, invoice.interest_amount, invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description, invoice.created_at from public.invoices as invoice join public.tenants as tenant on tenant.id = invoice.tenant_id where invoice.organization_id = target_organization_id order by invoice.due_on asc, invoice.created_at desc;
end;
$$;

revoke all on function public.apply_invoice_adjustment(uuid, uuid, public.invoice_adjustment_type, numeric, text), public.renegotiate_invoice(uuid, uuid, date, numeric, text), public.list_invoices(uuid) from public;
grant execute on function public.apply_invoice_adjustment(uuid, uuid, public.invoice_adjustment_type, numeric, text), public.renegotiate_invoice(uuid, uuid, date, numeric, text), public.list_invoices(uuid) to authenticated;
