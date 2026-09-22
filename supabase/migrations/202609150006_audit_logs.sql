-- Auditoria imutável de ações administrativas e operacionais.
-- A tabela não possui políticas de update/delete; gravação apenas via função SECURITY DEFINER.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_manager on public.audit_logs;
create policy audit_logs_select_manager on public.audit_logs
  for select to authenticated
  using (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists audit_logs_select_platform_administrator on public.audit_logs;
create policy audit_logs_select_platform_administrator on public.audit_logs
  for select to authenticated
  using (public.is_platform_administrator());

create or replace function public.record_audit_event(
  target_organization_id uuid,
  audit_action text,
  audit_entity_type text,
  audit_entity_id uuid,
  audit_summary text,
  audit_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare actor_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_organization_id is not null and not public.is_active_organization_member(target_organization_id) and not public.is_platform_administrator() then
    raise exception 'not allowed to record audit for this organization';
  end if;
  select lower(email) into actor_email from auth.users where id = auth.uid();
  insert into public.audit_logs (organization_id, actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (target_organization_id, auth.uid(), actor_email, btrim(audit_action), btrim(audit_entity_type), audit_entity_id, btrim(audit_summary), coalesce(audit_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.list_audit_logs(target_organization_id uuid, filter_limit integer default 100)
returns table (id uuid, actor_email text, action text, entity_type text, entity_id uuid, summary text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select log.id, log.actor_email, log.action, log.entity_type, log.entity_id, log.summary, log.metadata, log.created_at
    from public.audit_logs log
    where log.organization_id = target_organization_id
    order by log.created_at desc
    limit greatest(coalesce(filter_limit, 100), 1);
end;
$$;

revoke all on function public.record_audit_event(uuid, text, text, uuid, text, jsonb) from public;
revoke all on function public.list_audit_logs(uuid, integer) from public;
grant execute on function public.record_audit_event(uuid, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.list_audit_logs(uuid, integer) to authenticated;
