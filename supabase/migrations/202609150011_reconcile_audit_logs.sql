-- Reconcilia audit_logs com o formato esperado por record_audit_event/list_audit_logs.
-- A tabela já existia desde 202609120002 com actor_user_id e sem actor_email/summary.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_user_id')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'actor_id') then
    alter table public.audit_logs rename column actor_user_id to actor_id;
  end if;
end $$;

alter table public.audit_logs add column if not exists actor_email text;
alter table public.audit_logs add column if not exists summary text not null default '';
alter table public.audit_logs alter column organization_id drop not null;

drop policy if exists audit_logs_select_member on public.audit_logs;
