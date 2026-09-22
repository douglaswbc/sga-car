-- Encerramento com acerto: diária excedente e avarias da devolução geram fatura idempotente.

create or replace function public.settle_contract_return(
  target_organization_id uuid,
  target_contract_id uuid,
  target_actual_return_on date,
  settlement_due_on date default null
)
returns public.invoices
language plpgsql security definer set search_path = public
as $$
declare contract_row public.rental_contracts; late_days integer; damage_total numeric; settlement public.invoices;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  select * into contract_row from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id;
  if contract_row.id is null then raise exception 'contract not found'; end if;
  if contract_row.status <> 'active' then raise exception 'contract is not active'; end if;
  if target_actual_return_on < contract_row.starts_on then raise exception 'invalid return date'; end if;

  late_days := greatest(target_actual_return_on - contract_row.expected_return_on, 0);
  select coalesce(sum(damage.estimated_cost), 0) into damage_total
  from public.contract_inspections inspection
  join public.contract_inspection_damages damage on damage.inspection_id = inspection.id
  where inspection.contract_id = contract_row.id and inspection.type = 'return';

  update public.rental_contracts set status = 'completed', actual_return_on = target_actual_return_on, updated_at = now() where id = contract_row.id;
  update public.vehicles set status = 'available' where id = contract_row.vehicle_id and organization_id = target_organization_id and status = 'rented';

  settlement := null;
  if late_days > 0 or damage_total > 0 then
    insert into public.invoices (organization_id, tenant_id, contract_id, billing_period_starts_on, billing_period_ends_on, due_on, subtotal, amount_due, description)
    values (target_organization_id, contract_row.tenant_id, contract_row.id, target_actual_return_on, target_actual_return_on, coalesce(settlement_due_on, target_actual_return_on), 0, 0, 'Acerto de devolução')
    on conflict (contract_id, billing_period_starts_on, billing_period_ends_on) where contract_id is not null do nothing
    returning * into settlement;
    if settlement.id is not null then
      if late_days > 0 then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, settlement.id, 'extra_daily', 'Diária excedente (' || late_days || ' dia(s))', late_days, contract_row.daily_rate, round(late_days * contract_row.daily_rate, 2));
      end if;
      if damage_total > 0 then
        insert into public.invoice_items (organization_id, invoice_id, type, description, quantity, unit_amount, amount)
        values (target_organization_id, settlement.id, 'damage', 'Avarias da devolução', 1, round(damage_total, 2), round(damage_total, 2));
      end if;
      settlement := public.refresh_invoice_totals(settlement.id);
      perform public.enqueue_tenant_event(target_organization_id, contract_row.tenant_id, 'invoice_created',
        jsonb_build_object('tenant_name', (select full_name from public.tenants where id = contract_row.tenant_id), 'amount', settlement.amount_due, 'due_on', to_char(settlement.due_on, 'YYYY-MM-DD')),
        'invoice:' || settlement.id || ':created');
    end if;
  end if;
  return settlement;
end;
$$;

revoke all on function public.settle_contract_return(uuid, uuid, date, date) from public;
grant execute on function public.settle_contract_return(uuid, uuid, date, date) to authenticated;
