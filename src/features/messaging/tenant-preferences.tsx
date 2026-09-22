"use client";

import { useState } from "react";
import { FormMessage } from "@/components/form-message";
import { tenantPreferencesSchema } from "@/features/messaging/messaging-schema";
import type { TenantPreferences as Preferences } from "@/lib/supabase/types";

export function TenantPreferences({ organizationId, tenantId, canManage, preferences }: Readonly<{ organizationId: string; tenantId: string; canManage: boolean; preferences: Preferences }>) {
  const [emailOptIn, setEmailOptIn] = useState(preferences.email_opt_in);
  const [whatsappOptIn, setWhatsappOptIn] = useState(preferences.whatsapp_opt_in);
  const [consent, setConsent] = useState(Boolean(preferences.consent_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async () => {
    const parsed = tenantPreferencesSchema.safeParse({ organizationId, tenantId, emailOptIn, whatsappOptIn, consent });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
    setSaving(true);
    setError("");
    setNotice("");
    const response = await fetch(`/api/tenants/${tenantId}/preferences`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const data: { error?: string } = await response.json();
    setSaving(false);
    if (response.ok) setNotice("Preferências salvas.");
    else setError(data.error ?? "Não foi possível salvar.");
  };
  return <div className="preference-form"><label className="checkbox-field"><input checked={emailOptIn} disabled={!canManage} onChange={(event) => setEmailOptIn(event.target.checked)} type="checkbox" />Receber e-mails</label><label className="checkbox-field"><input checked={whatsappOptIn} disabled={!canManage} onChange={(event) => setWhatsappOptIn(event.target.checked)} type="checkbox" />Receber WhatsApp</label><label className="checkbox-field"><input checked={consent} disabled={!canManage} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />Consentimento LGPD registrado{preferences.consent_at ? <small className="field-hint">Registrado em {new Date(preferences.consent_at).toLocaleDateString("pt-BR")}</small> : null}</label>{canManage ? <button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar preferências"}</button> : null}<FormMessage tone="error">{error}</FormMessage><FormMessage tone="notice">{notice}</FormMessage></div>;
}
