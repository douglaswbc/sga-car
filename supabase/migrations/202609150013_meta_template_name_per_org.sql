-- O nome do template Meta deve ser único por organização, não globalmente.
-- Antes, um nome usado por outra organização bloqueava a criação.

alter table public.meta_whatsapp_templates drop constraint if exists meta_whatsapp_templates_name_key;
alter table public.meta_whatsapp_templates drop constraint if exists meta_whatsapp_templates_org_name_key;
alter table public.meta_whatsapp_templates add constraint meta_whatsapp_templates_org_name_key unique nulls not distinct (organization_id, name);

create or replace function public.create_organization_meta_whatsapp_template(target_organization_id uuid, template_name text, template_category text, template_language text, template_body text, template_examples jsonb)
returns public.meta_whatsapp_templates language plpgsql security definer set search_path = public as $$
declare saved public.meta_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if template_name !~ '^[a-z][a-z0-9_]{2,511}$' then raise exception 'template name must use lowercase letters, numbers and underscores'; end if;
  if template_category not in ('UTILITY', 'MARKETING', 'AUTHENTICATION') then raise exception 'invalid template category'; end if;
  if char_length(trim(template_body)) not between 1 and 1024 then raise exception 'template body must have 1 to 1024 characters'; end if;
  if jsonb_typeof(coalesce(template_examples, '[]'::jsonb)) <> 'array' then raise exception 'invalid examples'; end if;
  if exists (select 1 from public.meta_whatsapp_templates where organization_id = target_organization_id and name = trim(template_name)) then
    raise exception 'a template with this name already exists for this organization';
  end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) to authenticated;
