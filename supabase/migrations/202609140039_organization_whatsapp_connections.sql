create table public.organization_whatsapp_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  business_account_id text not null check (char_length(btrim(business_account_id)) between 1 and 100),
  phone_number_id text not null check (char_length(btrim(phone_number_id)) between 1 and 100),
  access_token_ciphertext text not null check (char_length(access_token_ciphertext) > 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organization_whatsapp_connections_set_updated_at before update on public.organization_whatsapp_connections for each row execute function public.set_updated_at();
alter table public.organization_whatsapp_connections enable row level security;
create policy organization_whatsapp_connections_no_client_access on public.organization_whatsapp_connections for select to authenticated using (false);

alter table public.meta_whatsapp_templates add column organization_id uuid references public.organizations(id) on delete cascade;
alter table public.meta_whatsapp_templates drop constraint meta_whatsapp_templates_code_key;
alter table public.meta_whatsapp_templates add constraint meta_whatsapp_templates_organization_code_key unique nulls not distinct (organization_id, code);
create index meta_whatsapp_templates_organization_idx on public.meta_whatsapp_templates (organization_id, scheduled_at);
drop policy meta_whatsapp_templates_read_active_member on public.meta_whatsapp_templates;
create policy meta_whatsapp_templates_read_organization_member on public.meta_whatsapp_templates for select to authenticated using (organization_id is not null and public.is_active_organization_member(organization_id));

create function public.ensure_organization_meta_whatsapp_templates(target_organization_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, scheduled_at)
  select target_organization_id, source.code, 'sga_' || substr(replace(target_organization_id::text, '-', ''), 1, 12) || '_' || source.code, source.body, source.scheduled_at
  from public.meta_whatsapp_templates source where source.organization_id is null
  on conflict (organization_id, code) do nothing;
end;
$$;
create function public.list_organization_meta_whatsapp_templates(target_organization_id uuid)
returns table (id uuid, code text, name text, body text, scheduled_at time, status text, rejection_reason text, last_synced_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select t.id, t.code, t.name, t.body, t.scheduled_at, t.status, t.rejection_reason, t.last_synced_at from public.meta_whatsapp_templates t where t.organization_id = target_organization_id order by t.scheduled_at;
end;
$$;
create function public.get_organization_whatsapp_connection_status(target_organization_id uuid)
returns table (business_account_id text, phone_number_id text, configured boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query select c.business_account_id, c.phone_number_id, true from public.organization_whatsapp_connections c where c.organization_id = target_organization_id;
end;
$$;
revoke all on function public.ensure_organization_meta_whatsapp_templates(uuid), public.list_organization_meta_whatsapp_templates(uuid), public.get_organization_whatsapp_connection_status(uuid) from public;
grant execute on function public.ensure_organization_meta_whatsapp_templates(uuid), public.list_organization_meta_whatsapp_templates(uuid), public.get_organization_whatsapp_connection_status(uuid) to authenticated;
