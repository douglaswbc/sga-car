drop function if exists public.list_tenants(uuid);

create function public.list_tenants(target_organization_id uuid)
returns table (id uuid, full_name text, document_number text, email text, phone text, status public.tenant_status, is_eligible boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select t.id, t.full_name, t.document_number, t.email, t.phone, t.status,
    (
      t.status = 'active'
      and exists (
        select 1 from public.tenant_documents d
        where d.tenant_id = t.id and d.organization_id = t.organization_id
          and d.type = 'cnh' and d.expires_on is not null and d.expires_on >= current_date
      )
    ) as is_eligible,
    t.created_at
  from public.tenants t
  where t.organization_id = target_organization_id
  order by t.full_name;
end;
$$;

create function public.list_tenant_payments(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, invoice_id uuid, paid_on date, amount numeric, method public.payment_method, receipt_url text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select p.id, p.invoice_id, p.paid_on, p.amount, p.method, p.receipt_url, p.note, p.created_at
  from public.payments p
  join public.invoices i on i.id = p.invoice_id
  where p.organization_id = target_organization_id and i.tenant_id = target_tenant_id
  order by p.paid_on desc, p.created_at desc;
end;
$$;

revoke all on function public.list_tenants(uuid) from public;
revoke all on function public.list_tenant_payments(uuid, uuid) from public;
grant execute on function public.list_tenants(uuid) to authenticated;
grant execute on function public.list_tenant_payments(uuid, uuid) to authenticated;
