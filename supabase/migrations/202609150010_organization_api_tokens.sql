-- Tokens de API por organização (integração externa, ex.: n8n) e configuração de entrega.
-- O valor bruto do token nunca é armazenado: apenas o hash SHA-256 calculado no servidor.

create table if not exists public.organization_api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_api_tokens_org_idx on public.organization_api_tokens (organization_id, created_at desc);

alter table public.organization_api_tokens enable row level security;

drop policy if exists organization_api_tokens_select_manager on public.organization_api_tokens;
create policy organization_api_tokens_select_manager on public.organization_api_tokens
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create table if not exists public.organization_messaging_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  whatsapp_delivery text not null default 'sga',
  updated_at timestamptz not null default now(),
  constraint organization_messaging_settings_delivery_check check (whatsapp_delivery in ('sga', 'n8n'))
);

alter table public.organization_messaging_settings enable row level security;

drop policy if exists organization_messaging_settings_select_member on public.organization_messaging_settings;
create policy organization_messaging_settings_select_member on public.organization_messaging_settings
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.create_organization_api_token(
  target_organization_id uuid,
  token_name text,
  token_hash text,
  token_prefix_value text,
  token_scopes text[],
  token_expires_at timestamptz default null
)
returns table (id uuid, name text, token_prefix text, scopes text[], expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare created public.organization_api_tokens;
declare allowed text[] := array['messaging:send', 'messaging:read', 'invoices:read', 'tenants:read', 'contracts:read'];
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(token_name), '') = '' then raise exception 'token name is required'; end if;
  if coalesce(btrim(token_hash), '') = '' then raise exception 'token hash is required'; end if;
  if array_length(token_scopes, 1) is null or not (token_scopes <@ allowed) then raise exception 'invalid scopes'; end if;
  if token_expires_at is not null and token_expires_at <= now() then raise exception 'expiration must be in the future'; end if;
  insert into public.organization_api_tokens (organization_id, name, token_hash, token_prefix, scopes, created_by, expires_at)
  values (target_organization_id, btrim(token_name), btrim(token_hash), btrim(token_prefix_value), token_scopes, auth.uid(), token_expires_at)
  returning * into created;
  perform public.record_audit_event(target_organization_id, 'api_token.created', 'organization_api_token', created.id, 'Token de API criado: ' || created.name);
  return query select created.id, created.name, created.token_prefix, created.scopes, created.expires_at, created.created_at;
end;
$$;

create or replace function public.list_organization_api_tokens(target_organization_id uuid)
returns table (id uuid, name text, token_prefix text, scopes text[], last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select token.id, token.name, token.token_prefix, token.scopes, token.last_used_at, token.expires_at, token.revoked_at, token.created_at
    from public.organization_api_tokens token
    where token.organization_id = target_organization_id
    order by token.created_at desc;
end;
$$;

create or replace function public.revoke_organization_api_token(target_organization_id uuid, target_token_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare token_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  update public.organization_api_tokens set revoked_at = now()
  where id = target_token_id and organization_id = target_organization_id and revoked_at is null
  returning name into token_name;
  if token_name is null then raise exception 'token not found'; end if;
  perform public.record_audit_event(target_organization_id, 'api_token.revoked', 'organization_api_token', target_token_id, 'Token de API revogado: ' || token_name);
end;
$$;

create or replace function public.resolve_organization_api_token(presented_token_hash text)
returns table (token_id uuid, organization_id uuid, scopes text[])
language plpgsql security definer set search_path = public
as $$
declare token_row public.organization_api_tokens; organization_state public.organization_status;
begin
  select * into token_row from public.organization_api_tokens where token_hash = presented_token_hash limit 1;
  if token_row.id is null then raise exception 'invalid token'; end if;
  if token_row.revoked_at is not null then raise exception 'token revoked'; end if;
  if token_row.expires_at is not null and token_row.expires_at <= now() then raise exception 'token expired'; end if;
  select status into organization_state from public.organizations where id = token_row.organization_id;
  if organization_state <> 'active' then raise exception 'organization is not active'; end if;
  update public.organization_api_tokens set last_used_at = now() where id = token_row.id;
  return query select token_row.id, token_row.organization_id, token_row.scopes;
end;
$$;

create or replace function public.get_organization_messaging_settings(target_organization_id uuid)
returns table (whatsapp_delivery text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select coalesce(settings.whatsapp_delivery, 'sga') from public.organization_messaging_settings settings where settings.organization_id = target_organization_id
  union all select 'sga' where not exists (select 1 from public.organization_messaging_settings where organization_id = target_organization_id);
end;
$$;

create or replace function public.set_organization_messaging_settings(target_organization_id uuid, delivery text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if delivery not in ('sga', 'n8n') then raise exception 'invalid delivery provider'; end if;
  insert into public.organization_messaging_settings (organization_id, whatsapp_delivery, updated_at)
  values (target_organization_id, delivery, now())
  on conflict (organization_id) do update set whatsapp_delivery = excluded.whatsapp_delivery, updated_at = now();
end;
$$;

revoke all on function public.create_organization_api_token(uuid, text, text, text, text[], timestamptz) from public;
revoke all on function public.list_organization_api_tokens(uuid) from public;
revoke all on function public.revoke_organization_api_token(uuid, uuid) from public;
revoke all on function public.resolve_organization_api_token(text) from public;
revoke all on function public.get_organization_messaging_settings(uuid) from public;
revoke all on function public.set_organization_messaging_settings(uuid, text) from public;

grant execute on function public.create_organization_api_token(uuid, text, text, text, text[], timestamptz) to authenticated;
grant execute on function public.list_organization_api_tokens(uuid) to authenticated;
grant execute on function public.revoke_organization_api_token(uuid, uuid) to authenticated;
grant execute on function public.resolve_organization_api_token(text) to anon, authenticated;
grant execute on function public.get_organization_messaging_settings(uuid) to authenticated;
grant execute on function public.set_organization_messaging_settings(uuid, text) to authenticated;
