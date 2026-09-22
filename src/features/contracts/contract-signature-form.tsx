"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { useToast } from "@/components/toast";

type Props = {
  organizationId: string;
  contractId: string;
  defaults: { tenantName: string; tenantDocument: string; companyName: string };
};

export function ContractSignatureForm({ organizationId, contractId, defaults }: Readonly<Props>) {
  const router = useRouter(); const { show } = useToast();
  const [role, setRole] = useState<"tenant" | "company">("tenant");
  const [name, setName] = useState(defaults.tenantName);
  const [document, setDocument] = useState(defaults.tenantDocument);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const switchRole = (value: "tenant" | "company") => {
    setRole(value);
    setName(value === "tenant" ? defaults.tenantName : defaults.companyName);
    setDocument(value === "tenant" ? defaults.tenantDocument : "");
  };

  const sign = async () => {
    setSaving(true); setError("");
    const response = await fetch(`/api/contracts/${contractId}/signatures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, role, name, document }),
    });
    const data: { error?: string } = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível registrar a assinatura."); return; }
    show("Assinatura registrada.");
    router.refresh();
  };

  return (
    <div className="billing-fields no-print">
      <legend>Registrar assinatura</legend>
      <FormMessage tone="error">{error}</FormMessage>
      <label>Signatário
        <select onChange={(event) => switchRole(event.target.value as "tenant" | "company")} value={role}>
          <option value="tenant">Locatário</option>
          <option value="company">Locadora</option>
        </select>
      </label>
      <label>Nome<input maxLength={160} onChange={(event) => setName(event.target.value)} value={name} /></label>
      <label>CPF/CNPJ (opcional)<input maxLength={40} onChange={(event) => setDocument(event.target.value)} value={document} /></label>
      <button className="button" disabled={saving || !name} onClick={sign} type="button">{saving ? "Assinando..." : "Assinar contrato"}</button>
    </div>
  );
}
