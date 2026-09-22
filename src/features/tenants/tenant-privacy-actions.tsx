"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

export function TenantPrivacyActions({ organizationId, tenantId, tenantName }: Readonly<{ organizationId: string; tenantId: string; tenantName: string }>) {
  const router = useRouter(); const { show } = useToast();
  const [running, setRunning] = useState(false);

  const anonymize = async () => {
    if (!window.confirm(`Anonimizar os dados pessoais de ${tenantName}? Esta ação é irreversível e mantém apenas os registros financeiros.`)) return;
    setRunning(true);
    const response = await fetch(`/api/tenants/${tenantId}/anonymize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
    const data: { error?: string } = await response.json().catch(() => ({}));
    setRunning(false);
    if (!response.ok) { show(data.error ?? "Não foi possível anonimizar.", "error"); return; }
    show("Dados pessoais anonimizados.");
    router.refresh();
  };

  return <div className="connection-actions"><a className="button button--secondary" href={`/api/tenants/${tenantId}/export?organizationId=${organizationId}`}>Exportar dados (LGPD)</a><button className="button button--danger" disabled={running} onClick={anonymize} type="button">{running ? "Anonimizando..." : "Anonimizar dados"}</button></div>;
}
