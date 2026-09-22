import { z } from "zod";

export const messageChannelSchema = z.enum(["email", "whatsapp"]);
export const messageEventSchema = z.enum(["member_invite", "invoice_created", "payment_receipt", "invoice_due_soon", "invoice_overdue"]);

export const messageTemplateSchema = z.object({
  organizationId: z.string().uuid(),
  channel: messageChannelSchema,
  event: messageEventSchema,
  subject: z.string().trim().max(200),
  body: z.string().trim().min(1, "Informe o corpo da mensagem.").max(4000),
  providerTemplateName: z.string().trim().max(200),
  providerTemplateLanguage: z.string().trim().max(20),
}).refine((data) => data.channel !== "email" || data.subject.length > 0, { message: "Informe o assunto do e-mail.", path: ["subject"] });

export const messageRetrySchema = z.object({ organizationId: z.string().uuid(), messageId: z.string().uuid() });

export const tenantPreferencesSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  emailOptIn: z.boolean(),
  whatsappOptIn: z.boolean(),
  consent: z.boolean(),
});
