-- Seleção de organização ativa quando o usuário participa de mais de uma.

create table if not exists public.user_organization_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_organization_id uuid references public.organizations(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_organization_preferences enable row level security;

drop policy if exists user_organization_preferences_select_own on public.user_organization_preferences;
create policy user_organization_preferences_select_own on public.user_organization_preferences
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.set_active_organization(target_organization_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  insert into public.user_organization_preferences (user_id, active_organization_id, updated_at)
  values (auth.uid(), target_organization_id, now())
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id, updated_at = now();
end;
$$;

-- A organização escolhida passa a ser a primeira da lista; as telas usam find(status='active').
create or replace function public.get_my_organizations()
returns table (
  id uuid,
  name text,
  status public.organization_status,
  role public.organization_role,
  created_at timestamptz
)
language sql stable security invoker set search_path = public
as $$
  select o.id, o.name, o.status, m.role, o.created_at
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  left join public.user_organization_preferences pref on pref.user_id = m.user_id
  where m.user_id = auth.uid()
  order by (o.id = pref.active_organization_id) desc nulls last, o.created_at desc;
$$;

revoke all on function public.set_active_organization(uuid) from public;
grant execute on function public.set_active_organization(uuid) to authenticated;
