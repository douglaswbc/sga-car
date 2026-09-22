create or replace function public.list_invoices(target_organization_id uuid)
returns table (id uuid, contract_id uuid, tenant_id uuid, tenant_name text, due_on date, amount_due numeric, amount_paid numeric, status public.invoice_status, description text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  update public.invoices as invoice
  set status = 'overdue'
  where invoice.organization_id = target_organization_id
    and invoice.status = 'pending'
    and invoice.due_on < current_date;
  return query
  select invoice.id, invoice.contract_id, invoice.tenant_id, tenant.full_name, invoice.due_on, invoice.amount_due, invoice.amount_paid, invoice.status, invoice.description, invoice.created_at
  from public.invoices as invoice
  join public.tenants as tenant on tenant.id = invoice.tenant_id
  where invoice.organization_id = target_organization_id
  order by invoice.due_on asc, invoice.created_at desc;
end;
$$;

revoke all on function public.list_invoices(uuid) from public;
grant execute on function public.list_invoices(uuid) to authenticated;
