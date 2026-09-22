create table if not exists public.tenant_contact_preferences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_opt_in boolean not null default true,
  whatsapp_opt_in boolean not null default true,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_contact_preferences enable row level security;
drop policy if exists tenant_contact_preferences_select_member on public.tenant_contact_preferences;
drop policy if exists tenant_contact_preferences_write_operator on public.tenant_contact_preferences;
create policy tenant_contact_preferences_select_member on public.tenant_contact_preferences for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenant_contact_preferences_write_operator on public.tenant_contact_preferences for all to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]))
  with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create trigger tenant_contact_preferences_set_updated_at before update on public.tenant_contact_preferences for each row execute function public.set_updated_at();

create or replace function public.get_tenant_preferences(target_organization_id uuid, target_tenant_id uuid)
returns table (email_opt_in boolean, whatsapp_opt_in boolean, consent_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select coalesce(preference.email_opt_in, true), coalesce(preference.whatsapp_opt_in, true), preference.consent_at
  from (select 1) seed
  left join public.tenant_contact_preferences preference
    on preference.tenant_id = target_tenant_id and preference.organization_id = target_organization_id;
end;
$$;

create or replace function public.upsert_tenant_preferences(
  target_organization_id uuid, target_tenant_id uuid, preference_email_opt_in boolean, preference_whatsapp_opt_in boolean, preference_consent boolean
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  insert into public.tenant_contact_preferences (tenant_id, organization_id, email_opt_in, whatsapp_opt_in, consent_at)
  values (target_tenant_id, target_organization_id, coalesce(preference_email_opt_in, true), coalesce(preference_whatsapp_opt_in, true), case when preference_consent then now() else null end)
  on conflict (tenant_id) do update
    set email_opt_in = excluded.email_opt_in, whatsapp_opt_in = excluded.whatsapp_opt_in,
        consent_at = coalesce(excluded.consent_at, public.tenant_contact_preferences.consent_at);
end;
$$;

revoke all on function public.get_tenant_preferences(uuid, uuid) from public;
revoke all on function public.upsert_tenant_preferences(uuid, uuid, boolean, boolean, boolean) from public;
grant execute on function public.get_tenant_preferences(uuid, uuid) to authenticated;
grant execute on function public.upsert_tenant_preferences(uuid, uuid, boolean, boolean, boolean) to authenticated;
