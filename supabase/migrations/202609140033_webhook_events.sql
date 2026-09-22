create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(btrim(provider)) between 1 and 40),
  external_id text not null check (char_length(btrim(external_id)) between 1 and 200),
  organization_id uuid references public.organizations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_id)
);
create index if not exists webhook_events_received_idx on public.webhook_events (provider, received_at desc);

alter table public.webhook_events enable row level security;
