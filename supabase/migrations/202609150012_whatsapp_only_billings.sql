-- Mensagens de cobrança passam a ser somente WhatsApp (Meta Cloud API).
-- O e-mail (Resend) fica restrito a convites de equipe e e-mails de autenticação.
-- O parâmetro de canais tem padrão WhatsApp, permitindo reuso futuro sem quebrar chamadas.

drop function if exists public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text);

create or replace function public.enqueue_tenant_event(
  target_organization_id uuid,
  target_tenant_id uuid,
  message_event public.message_event,
  message_payload jsonb,
  dedupe_base text,
  message_channels public.message_channel[] default array['whatsapp']::public.message_channel[]
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare tenant_record public.tenants;
declare current_channel public.message_channel;
declare recipient text;
declare created_count integer := 0;
declare created_message public.messages;
begin
  select * into tenant_record from public.tenants where id = target_tenant_id and organization_id = target_organization_id;
  if tenant_record.id is null then return 0; end if;
  foreach current_channel in array message_channels loop
    recipient := case when current_channel = 'email' then tenant_record.email else tenant_record.phone end;
    if recipient is null or btrim(recipient) = '' then continue; end if;
    created_message := public.enqueue_message(target_organization_id, target_tenant_id, current_channel, message_event, recipient, message_payload, dedupe_base || ':' || current_channel);
    if created_message.id is not null then created_count := created_count + 1; end if;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.enqueue_tenant_event(uuid, uuid, public.message_event, jsonb, text, public.message_channel[]) from public;
