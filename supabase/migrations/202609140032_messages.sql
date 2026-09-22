do $$ begin
  create type public.message_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
  create type public.message_direction as enum ('outbound', 'inbound');
exception when duplicate_object then null;
end $$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  channel public.message_channel not null,
  event public.message_event not null,
  recipient text not null,
  subject text,
  body text,
  payload jsonb not null default '{}'::jsonb,
  status public.message_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  dedupe_key text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index if not exists messages_dispatch_idx on public.messages (status, next_attempt_at);
create index if not exists messages_tenant_idx on public.messages (organization_id, tenant_id, created_at desc);
create trigger messages_set_updated_at before update on public.messages for each row execute function public.set_updated_at();

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction public.message_direction not null default 'outbound',
  status public.message_status not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists message_events_message_idx on public.message_events (message_id, created_at desc);

alter table public.messages enable row level security;
alter table public.message_events enable row level security;
drop policy if exists messages_select_member on public.messages;
drop policy if exists message_events_select_member on public.message_events;
create policy messages_select_member on public.messages for select to authenticated using (public.is_active_organization_member(organization_id));
create policy message_events_select_member on public.message_events for select to authenticated using (public.is_active_organization_member(organization_id));

create or replace function public.enqueue_message(
  target_organization_id uuid, target_tenant_id uuid, message_channel public.message_channel, message_event public.message_event,
  message_recipient text, message_payload jsonb, message_dedupe_key text
)
returns public.messages language plpgsql security definer set search_path = public
as $$
declare created_message public.messages;
begin
  insert into public.messages (organization_id, tenant_id, channel, event, recipient, payload, dedupe_key)
  values (target_organization_id, target_tenant_id, message_channel, message_event, btrim(message_recipient), coalesce(message_payload, '{}'::jsonb), message_dedupe_key)
  on conflict (organization_id, dedupe_key) do nothing
  returning * into created_message;
  return created_message;
end;
$$;

create or replace function public.enqueue_tenant_event(
  target_organization_id uuid, target_tenant_id uuid, message_event public.message_event, message_payload jsonb, dedupe_base text
)
returns integer language plpgsql security definer set search_path = public
as $$
declare tenant_record public.tenants;
declare current_channel public.message_channel;
declare recipient text;
declare created_count integer := 0;
declare created_message public.messages;
begin
  select * into tenant_record from public.tenants where id = target_tenant_id and organization_id = target_organization_id;
  if tenant_record.id is null then return 0; end if;
  foreach current_channel in array array['email', 'whatsapp']::public.message_channel[] loop
    recipient := case when current_channel = 'email' then tenant_record.email else tenant_record.phone end;
    if recipient is null or btrim(recipient) = '' then continue; end if;
    created_message := public.enqueue_message(target_organization_id, target_tenant_id, current_channel, message_event, recipient, message_payload, dedupe_base || ':' || current_channel);
    if created_message.id is not null then created_count := created_count + 1; end if;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.enqueue_message(uuid, uuid, public.message_channel, public.message_event, text, jsonb, text) from public;
revoke all on function public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text) from public;
