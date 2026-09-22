do $$ begin
  create type public.tenant_document_type as enum ('cnh', 'proof_of_address', 'other');
exception when duplicate_object then null;
end $$;

create table public.tenant_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type public.tenant_document_type not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  url text,
  identifier text,
  category text,
  expires_on date,
  created_at timestamptz not null default now()
);
create index tenant_documents_tenant_idx on public.tenant_documents (organization_id, tenant_id, created_at desc);
create unique index tenant_documents_single_cnh_idx on public.tenant_documents (organization_id, tenant_id) where type = 'cnh';

alter table public.tenant_documents enable row level security;
create policy tenant_documents_select_member on public.tenant_documents for select to authenticated using (public.is_active_organization_member(organization_id));
create policy tenant_documents_write_operator on public.tenant_documents for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'operations']::public.organization_role[]));

create function public.list_tenant_documents(target_organization_id uuid, target_tenant_id uuid)
returns table (id uuid, type public.tenant_document_type, name text, url text, identifier text, category text, expires_on date, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select d.id, d.type, d.name, d.url, d.identifier, d.category, d.expires_on, d.created_at
  from public.tenant_documents d
  where d.organization_id = target_organization_id and d.tenant_id = target_tenant_id
  order by d.created_at desc;
end;
$$;

create function public.add_tenant_document(
  target_organization_id uuid, target_tenant_id uuid, document_type public.tenant_document_type,
  document_name text, document_url text, document_identifier text, document_category text, document_expires_on date
)
returns public.tenant_documents language plpgsql security definer set search_path = public
as $$
declare created_document public.tenant_documents;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if not exists (select 1 from public.tenants where id = target_tenant_id and organization_id = target_organization_id) then raise exception 'tenant not found'; end if;
  if char_length(btrim(coalesce(document_name, ''))) < 1 then raise exception 'invalid document name'; end if;
  insert into public.tenant_documents (organization_id, tenant_id, type, name, url, identifier, category, expires_on)
  values (target_organization_id, target_tenant_id, document_type, btrim(document_name), nullif(btrim(document_url), ''), nullif(btrim(document_identifier), ''), nullif(btrim(document_category), ''), document_expires_on)
  returning * into created_document;
  return created_document;
end;
$$;

create function public.delete_tenant_document(target_organization_id uuid, target_tenant_id uuid, target_document_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.tenant_documents where id = target_document_id and tenant_id = target_tenant_id and organization_id = target_organization_id;
  if not found then raise exception 'document not found'; end if;
end;
$$;

revoke all on function public.list_tenant_documents(uuid, uuid) from public;
revoke all on function public.add_tenant_document(uuid, uuid, public.tenant_document_type, text, text, text, text, date) from public;
revoke all on function public.delete_tenant_document(uuid, uuid, uuid) from public;
grant execute on function public.list_tenant_documents(uuid, uuid) to authenticated;
grant execute on function public.add_tenant_document(uuid, uuid, public.tenant_document_type, text, text, text, text, date) to authenticated;
grant execute on function public.delete_tenant_document(uuid, uuid, uuid) to authenticated;
