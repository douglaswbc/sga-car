"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { formatDocument, formatPhone } from "@/features/tenants/registration-schema";
import { tenantUpdateSchema } from "@/features/tenants/tenant-schema";
import type { Tenant } from "@/lib/supabase/types";

type Props = { organizationId: string; tenant: Tenant };
type Values = { fullName: string; documentNumber: string; email: string; phone: string; status: Tenant["status"] };

export function TenantActions({ organizationId, tenant }: Readonly<Props>) {
  const router = useRouter(); const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Values>({
    fullName: tenant.full_name,
    documentNumber: tenant.document_number ? formatDocument(tenant.document_number) : "",
    email: tenant.email ?? "",
    phone: tenant.phone ? formatPhone(tenant.phone) : "",
    status: tenant.status,
  });
  const update = (field: keyof Values, value: string) => setValues((current) => ({ ...current, [field]: value } as Values));
  const close = () => { setOpen(false); setError(""); };

  const save = async () => {
    const parsed = tenantUpdateSchema.safeParse({ ...values, organizationId, tenantId: tenant.id });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/tenants/${tenant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível atualizar.");
      show("Locatário atualizado."); router.push("/locatarios"); router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Excluir ${tenant.full_name}? Esta ação não pode ser desfeita.`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/tenants/${tenant.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir.");
      show("Locatário excluído."); router.push("/locatarios"); router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir.");
      setSaving(false);
    }
  };

  return <><button className="table-action" onClick={() => setOpen(true)} type="button">Gerenciar</button>{open ? <Modal onClose={close} title="Gerenciar locatário"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Nome completo<input maxLength={160} onChange={(event) => update("fullName", event.target.value)} value={values.fullName} /></label><label>CPF ou CNPJ<input inputMode="numeric" maxLength={18} onChange={(event) => update("documentNumber", formatDocument(event.target.value))} value={values.documentNumber} /></label><label>E-mail<input maxLength={254} onChange={(event) => update("email", event.target.value)} type="email" value={values.email} /></label><label>Celular<input inputMode="tel" maxLength={15} onChange={(event) => update("phone", formatPhone(event.target.value))} value={values.phone} /></label><label>Status<select onChange={(event) => update("status", event.target.value)} value={values.status}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label><div className="wizard-actions"><button className="button button--danger" disabled={saving} onClick={remove} type="button">Excluir</button><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar"}</button></div></div></Modal> : null}</>;
}
