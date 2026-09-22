do $$ begin
  create type public.message_channel as enum ('email', 'whatsapp');
  create type public.message_event as enum ('member_invite', 'invoice_created', 'payment_receipt', 'invoice_due_soon', 'invoice_overdue');
exception when duplicate_object then null;
end $$;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  channel public.message_channel not null,
  event public.message_event not null,
  subject text,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  provider_template_name text,
  provider_template_language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, channel, event)
);

alter table public.message_templates enable row level security;
drop policy if exists message_templates_select_member on public.message_templates;
drop policy if exists message_templates_write_manager on public.message_templates;
create policy message_templates_select_member on public.message_templates for select to authenticated
  using (organization_id is null or public.is_active_organization_member(organization_id));
create policy message_templates_write_manager on public.message_templates for all to authenticated
  using (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
  with check (organization_id is not null and public.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create trigger message_templates_set_updated_at before update on public.message_templates for each row execute function public.set_updated_at();

insert into public.message_templates (organization_id, channel, event, subject, body) values
  (null, 'email', 'member_invite', 'Você foi adicionado à organização {{organization_name}}', 'Olá {{member_name}}, você foi adicionado à equipe de {{organization_name}} no SGA.'),
  (null, 'email', 'invoice_created', 'Nova cobrança — vencimento {{due_on}}', 'Olá {{tenant_name}}, foi gerada uma cobrança de {{amount}} com vencimento em {{due_on}}.'),
  (null, 'email', 'payment_receipt', 'Recibo de pagamento', 'Olá {{tenant_name}}, recebemos {{amount}} em {{paid_on}}. Obrigado!'),
  (null, 'email', 'invoice_due_soon', 'Lembrete de vencimento', 'Olá {{tenant_name}}, sua cobrança de {{amount}} vence em {{due_on}}.'),
  (null, 'email', 'invoice_overdue', 'Cobrança vencida', 'Olá {{tenant_name}}, identificamos a cobrança de {{amount}} vencida em {{due_on}}.'),
  (null, 'whatsapp', 'member_invite', null, 'SGA: {{member_name}}, você foi adicionado à equipe de {{organization_name}}.'),
  (null, 'whatsapp', 'invoice_created', null, 'SGA: {{tenant_name}}, nova cobrança de {{amount}} com vencimento em {{due_on}}.'),
  (null, 'whatsapp', 'payment_receipt', null, 'SGA: recebemos {{amount}} referente a {{tenant_name}} em {{paid_on}}.'),
  (null, 'whatsapp', 'invoice_due_soon', null, 'SGA: {{tenant_name}}, sua cobrança de {{amount}} vence em {{due_on}}.'),
  (null, 'whatsapp', 'invoice_overdue', null, 'SGA: {{tenant_name}}, a cobrança de {{amount}} venceu em {{due_on}}.')
on conflict do nothing;

create or replace function public.list_message_templates(target_organization_id uuid)
returns table (channel public.message_channel, event public.message_event, subject text, body text, provider_template_name text, provider_template_language text, is_custom boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
  return query
  select distinct on (template.channel, template.event)
    template.channel, template.event, template.subject, template.body, template.provider_template_name,
    template.provider_template_language, (template.organization_id is not null) as is_custom
  from public.message_templates template
  where template.organization_id is null or template.organization_id = target_organization_id
  order by template.channel, template.event, template.organization_id nulls last;
end;
$$;

create or replace function public.upsert_message_template(
  target_organization_id uuid, template_channel public.message_channel, template_event public.message_event,
  template_subject text, template_body text, template_provider_name text, template_provider_language text
)
returns public.message_templates language plpgsql security definer set search_path = public
as $$
declare saved_template public.message_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if char_length(btrim(coalesce(template_body, ''))) < 1 then raise exception 'invalid template body'; end if;
  insert into public.message_templates (organization_id, channel, event, subject, body, provider_template_name, provider_template_language)
  values (target_organization_id, template_channel, template_event, nullif(btrim(template_subject), ''), btrim(template_body), nullif(btrim(template_provider_name), ''), nullif(btrim(template_provider_language), ''))
  on conflict (organization_id, channel, event) do update
    set subject = excluded.subject, body = excluded.body, provider_template_name = excluded.provider_template_name, provider_template_language = excluded.provider_template_language
  returning * into saved_template;
  return saved_template;
end;
$$;

revoke all on function public.list_message_templates(uuid) from public;
revoke all on function public.upsert_message_template(uuid, public.message_channel, public.message_event, text, text, text, text) from public;
grant execute on function public.list_message_templates(uuid) to authenticated;
grant execute on function public.upsert_message_template(uuid, public.message_channel, public.message_event, text, text, text, text) to authenticated;
