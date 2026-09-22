-- Assinatura do contrato de locação (partes) para o documento em PDF.

create type public.contract_signer_role as enum ('tenant', 'company');

create table if not exists public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  signer_role public.contract_signer_role not null,
  signer_name text not null,
  signer_document text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (contract_id, signer_role)
);

create index if not exists contract_signatures_contract_idx on public.contract_signatures (contract_id);

alter table public.contract_signatures enable row level security;

drop policy if exists contract_signatures_select_member on public.contract_signatures;
create policy contract_signatures_select_member on public.contract_signatures
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create or replace function public.sign_rental_contract(target_organization_id uuid, target_contract_id uuid, signer_role public.contract_signer_role, signer_name text, signer_document text)
returns public.contract_signatures
language plpgsql security definer set search_path = public
as $$
declare created public.contract_signatures;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if coalesce(btrim(signer_name), '') = '' then raise exception 'signer name is required'; end if;
  if not exists (select 1 from public.rental_contracts where id = target_contract_id and organization_id = target_organization_id) then raise exception 'contract not found'; end if;
  insert into public.contract_signatures (organization_id, contract_id, signer_role, signer_name, signer_document, signed_at)
  values (target_organization_id, target_contract_id, signer_role, btrim(signer_name), nullif(btrim(signer_document), ''), now())
  on conflict (contract_id, signer_role) do update set signer_name = excluded.signer_name, signer_document = excluded.signer_document, signed_at = now()
  returning * into created;
  perform public.record_audit_event(target_organization_id, 'contract.signed', 'rental_contract', target_contract_id, 'Contrato assinado por ' || signer_role::text);
  return created;
end;
$$;

create or replace function public.list_contract_signatures(target_organization_id uuid, target_contract_id uuid)
returns setof public.contract_signatures
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query select * from public.contract_signatures where contract_id = target_contract_id and organization_id = target_organization_id order by signer_role;
end;
$$;

revoke all on function public.sign_rental_contract(uuid, uuid, public.contract_signer_role, text, text) from public;
revoke all on function public.list_contract_signatures(uuid, uuid) from public;
grant execute on function public.sign_rental_contract(uuid, uuid, public.contract_signer_role, text, text) to authenticated;
grant execute on function public.list_contract_signatures(uuid, uuid) to authenticated;
