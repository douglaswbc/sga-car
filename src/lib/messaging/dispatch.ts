import { query } from "@/lib/db";
import { renderTemplate, templateParameters, whatsappEventParameters } from "@/lib/messaging/render";
import { sendEmail } from "@/lib/messaging/providers/email";
import { sendWhatsApp } from "@/lib/messaging/providers/whatsapp";
import type { MessageChannel, MessageEvent } from "@/lib/supabase/types";

type ClaimedMessage = {
  id: string;
  organization_id: string;
  tenant_id: string | null;
  channel: MessageChannel;
  event: MessageEvent;
  recipient: string;
  subject: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type TemplateRow = { subject: string | null; body: string; provider_template_name: string | null; provider_template_language: string | null };

const backoffMinutes = [1, 5, 15, 60];

export async function runDueReminders(organizationId?: string): Promise<number> {
  const organizations = organizationId
    ? [{ id: organizationId }]
    : await query<{ id: string }>("select id from public.organizations where status = 'active'");
  let created = 0;
  for (const organization of organizations) {
    const rows = await query<{ enqueue_due_reminders: number }>("select public.enqueue_due_reminders($1, $2)", [organization.id, 3]);
    created += Number(rows[0]?.enqueue_due_reminders ?? 0);
  }
  return created;
}

async function claimMessages(limit: number, organizationId?: string): Promise<ClaimedMessage[]> {
  return query<ClaimedMessage>(
    `with claimed as (
       select id from public.messages
       where (status = 'pending' or (status = 'processing' and updated_at < now() - interval '10 minutes'))
         and next_attempt_at <= now()
         and ($2::uuid is null or organization_id = $2::uuid)
         and ($2::uuid is not null or not (
           channel = 'whatsapp' and organization_id in (
             select organization_id from public.organization_messaging_settings where whatsapp_delivery = 'n8n'
           )
         ))
       order by next_attempt_at
       limit $1
       for update skip locked
     )
     update public.messages message set status = 'processing', updated_at = now()
     from claimed where message.id = claimed.id
     returning message.id, message.organization_id, message.tenant_id, message.channel, message.event,
       message.recipient, message.subject, message.body, message.payload, message.attempts, message.max_attempts`,
    [limit, organizationId ?? null],
  );
}

async function isOptedOut(message: ClaimedMessage): Promise<boolean> {
  if (!message.tenant_id) return false;
  const rows = await query<{ email_opt_in: boolean; whatsapp_opt_in: boolean }>(
    "select email_opt_in, whatsapp_opt_in from public.tenant_contact_preferences where tenant_id = $1",
    [message.tenant_id],
  );
  if (!rows.length) return false;
  return message.channel === "email" ? !rows[0].email_opt_in : !rows[0].whatsapp_opt_in;
}

async function resolveTemplate(organizationId: string, channel: MessageChannel, event: MessageEvent): Promise<TemplateRow | undefined> {
  const rows = await query<TemplateRow>(
    `select subject, body, provider_template_name, provider_template_language from public.message_templates
     where (organization_id = $1 or organization_id is null) and channel = $2 and event = $3
     order by organization_id nulls last limit 1`,
    [organizationId, channel, event],
  );
  return rows[0];
}

async function logEvent(message: ClaimedMessage, status: string, detail: string | null) {
  await query("insert into public.message_events (message_id, organization_id, direction, status, detail) values ($1, $2, 'outbound', $3, $4)", [message.id, message.organization_id, status, detail]);
}

export async function dispatchPendingMessages(limit = 25, organizationId?: string) {
  const reminders = await runDueReminders(organizationId);
  const messages = await claimMessages(limit, organizationId);
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  for (const message of messages) {
    try {
      if (await isOptedOut(message)) {
        await query("update public.messages set status = 'cancelled', updated_at = now() where id = $1", [message.id]);
        await logEvent(message, "cancelled", "Contato sem opt-in.");
        cancelled += 1;
        continue;
      }
      const template = await resolveTemplate(message.organization_id, message.channel, message.event);
      if (!template) throw new Error("Template de mensagem não encontrado.");
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      const body = renderTemplate(template.body, payload);
      const subject = template.subject ? renderTemplate(template.subject, payload) : null;
      let providerId: string | undefined;
      if (message.channel === "email") {
        providerId = (await sendEmail({ to: message.recipient, subject, body })).id;
      } else {
        providerId = (await sendWhatsApp({ organizationId: message.organization_id, to: message.recipient, body, templateName: template.provider_template_name, templateLanguage: template.provider_template_language, parameters: templateParameters(payload, whatsappEventParameters[message.event]) })).id;
      }
      await query("update public.messages set status = 'sent', subject = $2, body = $3, provider_message_id = $4, sent_at = now(), attempts = attempts + 1, last_error = null, updated_at = now() where id = $1", [message.id, subject, body, providerId ?? null]);
      await logEvent(message, "sent", null);
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const reason = error instanceof Error ? error.message : "Erro desconhecido.";
      if (attempts >= message.max_attempts) {
        await query("update public.messages set status = 'failed', attempts = $2, last_error = $3, updated_at = now() where id = $1", [message.id, attempts, reason]);
        failed += 1;
      } else {
        const delay = backoffMinutes[Math.min(attempts - 1, backoffMinutes.length - 1)];
        await query("update public.messages set status = 'pending', attempts = $2, last_error = $3, next_attempt_at = now() + make_interval(mins => $4), updated_at = now() where id = $1", [message.id, attempts, reason, delay]);
      }
      await logEvent(message, "failed", reason);
    }
  }
  return { reminders, processed: messages.length, sent, failed, cancelled };
}
