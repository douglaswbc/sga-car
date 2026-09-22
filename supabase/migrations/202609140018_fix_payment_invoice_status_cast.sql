create or replace function public.record_invoice_payment(target_organization_id uuid, target_invoice_id uuid, payment_paid_on date, payment_amount numeric, payment_method public.payment_method, payment_receipt_url text, payment_note text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_invoice public.invoices; created_payment public.payments; new_paid numeric;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance']::public.organization_role[]) then raise exception 'finance role is required'; end if;
  select * into target_invoice from public.invoices where id = target_invoice_id and organization_id = target_organization_id for update;
  if target_invoice.id is null or target_invoice.status in ('cancelled', 'reversed', 'paid') or payment_amount <= 0 then raise exception 'invoice is not payable'; end if;
  new_paid := target_invoice.amount_paid + payment_amount;
  if new_paid > target_invoice.amount_due then raise exception 'payment exceeds open balance'; end if;
  insert into public.payments (organization_id, invoice_id, paid_on, amount, method, receipt_url, note)
  values (target_organization_id, target_invoice_id, payment_paid_on, payment_amount, payment_method, nullif(trim(payment_receipt_url), ''), nullif(trim(payment_note), ''))
  returning * into created_payment;
  update public.invoices
  set amount_paid = new_paid,
      status = (case when new_paid = amount_due then 'paid' when due_on < current_date then 'overdue' else 'pending' end)::public.invoice_status
  where id = target_invoice_id;
  return created_payment;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text) from public;
grant execute on function public.record_invoice_payment(uuid, uuid, date, numeric, public.payment_method, text, text) to authenticated;
