alter table public.meta_whatsapp_templates
  add column category text not null default 'UTILITY' check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  add column language text not null default 'pt_BR' check (char_length(language) between 2 and 20),
  add column body_examples jsonb not null default '[]'::jsonb check (jsonb_typeof(body_examples) = 'array');

create function public.create_organization_meta_whatsapp_template(target_organization_id uuid, template_name text, template_category text, template_language text, template_body text, template_examples jsonb)
returns public.meta_whatsapp_templates language plpgsql security definer set search_path = public as $$
declare saved public.meta_whatsapp_templates;
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'manager role is required'; end if;
  if template_name !~ '^[a-z][a-z0-9_]{2,511}$' or template_category not in ('UTILITY', 'MARKETING', 'AUTHENTICATION') or char_length(trim(template_body)) not between 1 and 1024 or jsonb_typeof(coalesce(template_examples, '[]'::jsonb)) <> 'array' then raise exception 'invalid Meta template'; end if;
  insert into public.meta_whatsapp_templates (organization_id, code, name, body, category, language, body_examples, scheduled_at)
  values (target_organization_id, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), trim(template_name), trim(template_body), template_category, template_language, coalesce(template_examples, '[]'::jsonb), '00:00')
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_organization_meta_whatsapp_template(uuid, text, text, text, text, jsonb) to authenticated;
