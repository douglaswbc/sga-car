-- Convites de membros com token e aceite.
-- O token bruto nunca é armazenado: o SGA grava apenas o hash SHA-256 calculado no servidor.

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'operations',
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint organization_invitations_role_check check (role <> 'owner')
);

create unique index if not exists organization_invitations_pending_email_idx
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

create index if not exists organization_invitations_org_idx
  on public.organization_invitations (organization_id, created_at desc);

alter table public.organization_invitations enable row level security;

drop policy if exists organization_invitations_select_manager on public.organization_invitations;
create policy organization_invitations_select_manager on public.organization_invitations
  for select to authenticated
  using (public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create or replace function public.create_organization_invitation(
  target_organization_id uuid,
  member_email text,
  member_role public.organization_role,
  invitation_token_hash text,
  invitation_expires_at timestamptz
)
returns public.organization_invitations
language plpgsql security definer set search_path = public
as $$
declare created public.organization_invitations;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if member_role = 'owner' then raise exception 'owner role cannot be invited'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  if coalesce(btrim(invitation_token_hash), '') = '' then raise exception 'invitation token is required'; end if;
  delete from public.organization_invitations
  where organization_id = target_organization_id and lower(email) = lower(btrim(member_email)) and accepted_at is null;
  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, expires_at)
  values (target_organization_id, lower(btrim(member_email)), member_role, btrim(invitation_token_hash), auth.uid(), invitation_expires_at)
  returning * into created;
  return created;
end;
$$;

create or replace function public.list_organization_invitations(target_organization_id uuid)
returns table (id uuid, email text, role public.organization_role, expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  return query
    select invitation.id, invitation.email, invitation.role, invitation.expires_at, invitation.created_at
    from public.organization_invitations invitation
    where invitation.organization_id = target_organization_id and invitation.accepted_at is null
    order by invitation.created_at desc;
end;
$$;

create or replace function public.revoke_organization_invitation(target_organization_id uuid, target_invitation_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  delete from public.organization_invitations
  where id = target_invitation_id and organization_id = target_organization_id and accepted_at is null;
  if not found then raise exception 'invitation not found'; end if;
end;
$$;

create or replace function public.get_organization_invitation(invitation_token_hash text)
returns table (id uuid, organization_id uuid, organization_name text, email text, role public.organization_role, expires_at timestamptz, accepted_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select invitation.id, invitation.organization_id, organization.name, invitation.email, invitation.role, invitation.expires_at, invitation.accepted_at
  from public.organization_invitations invitation
  join public.organizations organization on organization.id = invitation.organization_id
  where invitation.token_hash = invitation_token_hash
  limit 1;
$$;

create or replace function public.accept_organization_invitation(invitation_token_hash text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare invitation public.organization_invitations; current_email text; organization_state public.organization_status;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.organization_invitations where token_hash = invitation_token_hash limit 1;
  if invitation.id is null then raise exception 'invitation not found'; end if;
  if invitation.accepted_at is not null then raise exception 'invitation already accepted'; end if;
  if invitation.expires_at < now() then raise exception 'invitation expired'; end if;
  select lower(email) into current_email from auth.users where id = auth.uid();
  if current_email is null or current_email <> lower(invitation.email) then raise exception 'invitation email does not match the signed-in account'; end if;
  select status into organization_state from public.organizations where id = invitation.organization_id;
  if organization_state <> 'active' then raise exception 'organization is not active'; end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), invitation.role)
  on conflict (organization_id, user_id) do update set role = excluded.role
  where public.organization_members.role <> 'owner';
  if not found then raise exception 'owner role cannot be changed'; end if;
  update public.organization_invitations set accepted_at = now() where id = invitation.id;
  return invitation.organization_id;
end;
$$;

create or replace function public.enqueue_organization_invite(target_organization_id uuid, member_email text, member_name text, invite_url text)
returns public.messages
language plpgsql security definer set search_path = public
as $$
declare organization_name text;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if coalesce(btrim(member_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid member email'; end if;
  select name into organization_name from public.organizations where id = target_organization_id;
  return public.enqueue_message(target_organization_id, null, 'email', 'member_invite', btrim(member_email),
    jsonb_build_object(
      'member_name', coalesce(nullif(btrim(member_name), ''), btrim(member_email)),
      'organization_name', coalesce(organization_name, 'SGA'),
      'invite_url', coalesce(btrim(invite_url), '')
    ),
    'member:' || lower(btrim(member_email)) || ':invite:' || to_char(now(), 'YYYYMMDDHH24MISS'));
end;
$$;

update public.message_templates
set body = 'Olá {{member_name}}, você foi convidado para a equipe de {{organization_name}} no SGA. Aceite o convite em: {{invite_url}}'
where organization_id is null and channel = 'email' and event = 'member_invite';

revoke all on function public.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) from public;
revoke all on function public.list_organization_invitations(uuid) from public;
revoke all on function public.revoke_organization_invitation(uuid, uuid) from public;
revoke all on function public.get_organization_invitation(text) from public;
revoke all on function public.accept_organization_invitation(text) from public;
revoke all on function public.enqueue_organization_invite(uuid, text, text, text) from public;

grant execute on function public.create_organization_invitation(uuid, text, public.organization_role, text, timestamptz) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid, uuid) to authenticated;
grant execute on function public.get_organization_invitation(text) to anon, authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.enqueue_organization_invite(uuid, text, text, text) to authenticated;
