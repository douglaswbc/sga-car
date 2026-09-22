"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { messageTemplateSchema } from "@/features/messaging/messaging-schema";
import type { MessageTemplate } from "@/lib/supabase/types";

const channelLabels = { email: "E-mail", whatsapp: "WhatsApp" } as const;
const eventLabels = { member_invite: "Convite", invoice_created: "Cobrança gerada", payment_receipt: "Recibo", invoice_due_soon: "Vencimento próximo", invoice_overdue: "Vencida" } as const;

export function TemplateManager({ organizationId, canManage, templates }: Readonly<{ organizationId: string; canManage: boolean; templates: MessageTemplate[] }>) {
  const router = useRouter(); const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [providerName, setProviderName] = useState("");
  const [providerLanguage, setProviderLanguage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const start = (template: MessageTemplate) => {
    setSelected(template);
    setSubject(template.subject ?? "");
    setBody(template.body);
    setProviderName(template.provider_template_name ?? "");
    setProviderLanguage(template.provider_template_language ?? "");
    setError("");
    setOpen(true);
  };

  const save = async () => {
    if (!selected) return;
    const parsed = messageTemplateSchema.safeParse({ organizationId, channel: selected.channel, event: selected.event, subject, body, providerTemplateName: providerName, providerTemplateLanguage: providerLanguage });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
    setSaving(true);
    setError("");
    const response = await fetch("/api/messaging/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const data: { error?: string } = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error ?? "Não foi possível salvar o template.");
    show("Template salvo."); setOpen(false); router.refresh();
  };

  return <>
    <div className="table-wrap"><table><thead><tr><th>Canal</th><th>Evento</th><th>Assunto / Conteúdo</th><th>Origem</th>{canManage ? <th><span className="sr-only">Ação</span></th> : null}</tr></thead><tbody>{templates.map((template) => <tr key={`${template.channel}-${template.event}`}><td>{channelLabels[template.channel]}</td><td>{eventLabels[template.event]}</td><td>{template.subject ? <strong>{template.subject}</strong> : null}<small className="table-subtitle">{template.body}</small>{template.provider_template_name ? <small className="table-subtitle">Meta: {template.provider_template_name} ({template.provider_template_language ?? "pt_BR"})</small> : null}</td><td>{template.is_custom ? "Personalizado" : "Padrão"}</td>{canManage ? <td><button className="table-action" onClick={() => start(template)} type="button">Editar</button></td> : null}</tr>)}</tbody></table></div>
    {open && selected ? <Modal onClose={() => setOpen(false)} title={`${channelLabels[selected.channel]} · ${eventLabels[selected.event]}`}><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields">{selected.channel === "email" ? <label>Assunto<input maxLength={200} onChange={(event) => setSubject(event.target.value)} value={subject} /></label> : null}<label>Corpo da mensagem<textarea maxLength={4000} onChange={(event) => setBody(event.target.value)} rows={5} value={body} /></label>{selected.channel === "whatsapp" ? <><label>Template aprovado na Meta<input maxLength={200} onChange={(event) => setProviderName(event.target.value)} placeholder="nome_do_template" value={providerName} /></label><label>Idioma<input maxLength={20} onChange={(event) => setProviderLanguage(event.target.value)} placeholder="pt_BR" value={providerLanguage} /></label></> : null}<p className="field-hint">Use {"{{placeholders}}"} como {"{{tenant_name}}"}, {"{{amount}}"}, {"{{due_on}}"}, {"{{paid_on}}"}.</p><div className="wizard-actions"><button className="button button--secondary" disabled={saving} onClick={() => setOpen(false)} type="button">Cancelar</button><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar"}</button></div></div></Modal> : null}
  </>;
}
