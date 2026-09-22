"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";

export function ProcessQueue({ organizationId }: Readonly<{ organizationId: string }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = async () => {
    setRunning(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/messaging/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
    const data: { sent?: number; failed?: number; cancelled?: number; reminders?: number; error?: string } = await response.json();
    setRunning(false);
    if (!response.ok) return setError(data.error ?? "Não foi possível processar a fila.");
    setNotice(`Enviadas: ${data.sent ?? 0} · Falhas: ${data.failed ?? 0} · Canceladas: ${data.cancelled ?? 0} · Lembretes na fila: ${data.reminders ?? 0}`);
    router.refresh();
  };
  return <div className="queue-actions"><button className="button" disabled={running} onClick={run} type="button">{running ? "Processando..." : "Processar fila"}</button><FormMessage tone="error">{error}</FormMessage><FormMessage tone="notice">{notice}</FormMessage></div>;
}
