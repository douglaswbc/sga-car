-- LGPD: exportação de dados do titular e anonimização com retenção de registros financeiros.

create or replace function public.export_tenant_data(target_organization_id uuid, target_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  select jsonb_build_object(
    'tenant', (select to_jsonb(t) from (select id, full_name, document_number, email, phone, status, created_at from public.tenants where id = target_tenant_id) t),
    'address', coalesce((select jsonb_agg(to_jsonb(a)) from (select * from public.tenant_addresses where tenant_id = target_tenant_id) a), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(d)) from (select id, type, name, identifier, category, expires_on, created_at from public.tenant_documents where tenant_id = target_tenant_id) d), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(to_jsonb(c)) from (select id, vehicle_id, starts_on, expected_return_on, actual_return_on, daily_rate, status from public.rental_contracts where tenant_id = target_tenant_id) c), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i)) from (select id, contract_id, due_on, amount_due, amount_paid, status, description from public.invoices where tenant_id = target_tenant_id) i), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from (select pay.id, pay.invoice_id, pay.paid_on, pay.amount, pay.method, pay.note from public.payments pay join public.invoices inv on inv.id = pay.invoice_id where inv.tenant_id = target_tenant_id) p), '[]'::jsonb),
    'communications', coalesce((select jsonb_agg(to_jsonb(m)) from (select id, channel, event, subject, body, status, created_at from public.messages where tenant_id = target_tenant_id) m), '[]'::jsonb),
    'preferences', coalesce((select to_jsonb(pref) from (select email_opt_in, whatsapp_opt_in, consent_at from public.tenant_contact_preferences where tenant_id = target_tenant_id) pref), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.anonymize_tenant(target_organization_id uuid, target_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  delete from public.tenant_documents where tenant_id = target_tenant_id;
  delete from public.tenant_addresses where tenant_id = target_tenant_id;
  delete from public.tenant_contact_preferences where tenant_id = target_tenant_id;
  update public.messages set recipient = 'anonimizado', subject = null, body = null where tenant_id = target_tenant_id;
  update public.tenants set full_name = 'Titular anonimizado', document_number = null, email = null, phone = null, status = 'inactive' where id = target_tenant_id;
  perform public.record_audit_event(target_organization_id, 'tenant.anonymized', 'tenant', target_tenant_id, 'Dados pessoais do locatário anonimizados');
end;
$$;

revoke all on function public.export_tenant_data(uuid, uuid) from public;
revoke all on function public.anonymize_tenant(uuid, uuid) from public;
grant execute on function public.export_tenant_data(uuid, uuid) to authenticated;
grant execute on function public.anonymize_tenant(uuid, uuid) to authenticated;
