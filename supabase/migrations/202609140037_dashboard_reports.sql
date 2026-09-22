create table public.dashboard_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  created_at timestamptz not null default now()
);

create index dashboard_reports_owner_idx on public.dashboard_reports (organization_id, user_id, created_at desc);
alter table public.dashboard_reports enable row level security;
create policy dashboard_reports_select_own on public.dashboard_reports for select to authenticated using (user_id = auth.uid() and public.is_active_organization_member(organization_id));
create policy dashboard_reports_insert_own on public.dashboard_reports for insert to authenticated with check (user_id = auth.uid() and public.is_active_organization_member(organization_id));
create policy dashboard_reports_delete_own on public.dashboard_reports for delete to authenticated using (user_id = auth.uid() and public.is_active_organization_member(organization_id));

create function public.dashboard_received_amount(target_organization_id uuid, period_starts_on date, period_ends_on date)
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  if period_ends_on < period_starts_on then raise exception 'invalid period'; end if;
  return coalesce((select sum(amount) from public.payments where organization_id = target_organization_id and paid_on between period_starts_on and period_ends_on), 0);
end;
$$;

create function public.list_dashboard_reports(target_organization_id uuid)
returns table (id uuid, name text, starts_on date, ends_on date, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select r.id, r.name, r.starts_on, r.ends_on, r.created_at from public.dashboard_reports r where r.organization_id = target_organization_id and r.user_id = auth.uid() order by r.created_at desc;
end;
$$;

create function public.save_dashboard_report(target_organization_id uuid, report_name text, period_starts_on date, period_ends_on date)
returns public.dashboard_reports language plpgsql security definer set search_path = public as $$
declare created_report public.dashboard_reports;
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  if char_length(trim(report_name)) not between 1 and 80 or period_ends_on < period_starts_on then raise exception 'invalid dashboard report'; end if;
  insert into public.dashboard_reports (organization_id, user_id, name, starts_on, ends_on) values (target_organization_id, auth.uid(), trim(report_name), period_starts_on, period_ends_on) returning * into created_report;
  return created_report;
end;
$$;

revoke all on function public.dashboard_received_amount(uuid, date, date), public.list_dashboard_reports(uuid), public.save_dashboard_report(uuid, text, date, date) from public;
grant execute on function public.dashboard_received_amount(uuid, date, date), public.list_dashboard_reports(uuid), public.save_dashboard_report(uuid, text, date, date) to authenticated;
