"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

export function MessageActions({ organizationId, messageId }: Readonly<{ organizationId: string; messageId: string }>) {
  const router = useRouter();
  const { show } = useToast();
  const [saving, setSaving] = useState(false);
  const retry = async () => {
    setSaving(true);
    const response = await fetch(`/api/messaging/messages/${messageId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
    const data: { error?: string } = await response.json().catch(() => ({}));
    setSaving(false);
    if (response.ok) {
      show("Mensagem reenfileirada.");
      router.refresh();
    } else {
      show(data.error ?? "Não foi possível reenviar.", "error");
    }
  };
  return <button className="table-action" disabled={saving} onClick={retry} type="button">{saving ? "Enviando…" : "Reenviar"}</button>;
}
