create or replace function public.list_messages(
  target_organization_id uuid, filter_status public.message_status default null, filter_channel public.message_channel default null
)
returns table (id uuid, tenant_id uuid, tenant_name text, channel public.message_channel, event public.message_event, recipient text, subject text, body text, status public.message_status, attempts integer, last_error text, provider_message_id text, created_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select message.id, message.tenant_id, tenant.full_name, message.channel, message.event, message.recipient, message.subject, message.body, message.status,
    message.attempts, message.last_error, message.provider_message_id, message.created_at, message.sent_at
  from public.messages message
  left join public.tenants tenant on tenant.id = message.tenant_id
  where message.organization_id = target_organization_id
    and (filter_status is null or message.status = filter_status)
    and (filter_channel is null or message.channel = filter_channel)
  order by message.created_at desc
  limit 500;
end;
$$;

create or replace function public.list_tenant_communications(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, channel public.message_channel, event public.message_event, recipient text, subject text, body text, status public.message_status, attempts integer, last_error text, created_at timestamptz, sent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select message.id, message.channel, message.event, message.recipient, message.subject, message.body, message.status, message.attempts, message.last_error, message.created_at, message.sent_at
  from public.messages message
  where message.organization_id = target_organization_id and message.tenant_id = target_tenant_id
  order by message.created_at desc
  limit 200;
end;
$$;

create or replace function public.retry_message(target_organization_id uuid, target_message_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'finance', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  update public.messages set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
  where id = target_message_id and organization_id = target_organization_id;
  if not found then raise exception 'message not found'; end if;
end;
$$;

create or replace function public.enqueue_member_invite(target_organization_id uuid, member_email text, member_name text)
returns public.messages language plpgsql security definer set search_path = public
as $$
declare organization_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  select name into organization_name from public.organizations where id = target_organization_id;
  return public.enqueue_message(target_organization_id, null, 'email', 'member_invite', btrim(member_email),
    jsonb_build_object('member_name', coalesce(nullif(btrim(member_name), ''), btrim(member_email)), 'organization_name', coalesce(organization_name, 'SGA')),
    'member:' || lower(btrim(member_email)) || ':invite');
end;
$$;

create or replace function public.enqueue_due_reminders(target_organization_id uuid, horizon_days integer default 3)
returns integer language plpgsql security definer set search_path = public
as $$
declare target record; created_count integer := 0;
begin
  for target in
    select invoice.id, invoice.tenant_id, invoice.due_on, invoice.amount_due,
      case when invoice.due_on < current_date then 'invoice_overdue' else 'invoice_due_soon' end as reminder_event
    from public.invoices invoice
    where invoice.organization_id = target_organization_id
      and invoice.status in ('pending', 'overdue')
      and invoice.amount_due > invoice.amount_paid
      and invoice.due_on <= current_date + greatest(coalesce(horizon_days, 0), 0)
  loop
    created_count := created_count + public.enqueue_tenant_event(target_organization_id, target.tenant_id, target.reminder_event::public.message_event,
      jsonb_build_object('tenant_name', (select full_name from public.tenants where id = target.tenant_id), 'amount', target.amount_due, 'due_on', to_char(target.due_on, 'YYYY-MM-DD')),
      'invoice:' || target.id || ':' || target.reminder_event || ':' || to_char(target.due_on, 'YYYY-MM-DD'));
  end loop;
  return created_count;
end;
$$;

revoke all on function public.list_messages(uuid, public.message_status, public.message_channel) from public;
revoke all on function public.list_tenant_communications(uuid, uuid) from public;
revoke all on function public.retry_message(uuid, uuid) from public;
revoke all on function public.enqueue_member_invite(uuid, text, text) from public;
revoke all on function public.enqueue_due_reminders(uuid, integer) from public;
grant execute on function public.list_messages(uuid, public.message_status, public.message_channel) to authenticated;
grant execute on function public.list_tenant_communications(uuid, uuid) to authenticated;
grant execute on function public.retry_message(uuid, uuid) to authenticated;
grant execute on function public.enqueue_member_invite(uuid, text, text) to authenticated;
