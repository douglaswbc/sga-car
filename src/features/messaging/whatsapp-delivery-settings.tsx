"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { useToast } from "@/components/toast";
import { setWhatsappDelivery } from "@/features/organizations/api-token-actions";

const options = [
  {
    value: "sga",
    title: "Pelo SGA (automático)",
    description: "O SGA inicia e envia os avisos de cobrança pelo WhatsApp (Meta Cloud API), no processamento da fila. Não exige configuração externa.",
  },
  {
    value: "n8n",
    title: "Pelo n8n (via token de API)",
    description: "Uma automação externa (ex.: n8n) chama a API de integração com um token para iniciar o envio. O SGA continua enviando as mensagens; apenas o disparo automático do SGA é desativado para não duplicar.",
  },
] as const;

export function WhatsappDeliverySettings({ organizationId, current }: Readonly<{ organizationId: string; current: string }>) {
  const router = useRouter(); const { show } = useToast();
  const [delivery, setDelivery] = useState(current);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (value: string) => {
    if (value === delivery) return;
    const previous = delivery;
    setDelivery(value); setSaving(true); setError("");
    const result = await setWhatsappDelivery({ organizationId, delivery: value });
    setSaving(false);
    if (result.error) { setDelivery(previous); setError(result.error); return; }
    show("Configuração salva.");
    router.refresh();
  };

  return (
    <article className="panel admin-panel">
      <header className="panel-header">
        <div>
          <h2>Quem inicia os envios de WhatsApp</h2>
          <p>As mensagens são as cobranças e avisos de vencimento. A entrega é sempre feita pelo SGA, usando as credenciais da Meta desta organização.</p>
        </div>
        <span className={`status status--${delivery === "n8n" ? "neutral" : "success"}`}><span aria-hidden="true" />{delivery === "n8n" ? "n8n" : "SGA"}</span>
      </header>
      <div className="connection-body">
        <FormMessage tone="error">{error}</FormMessage>
        <div className="choice-list">
          {options.map((option) => (
            <label className={`choice${delivery === option.value ? " choice--selected" : ""}`} key={option.value}>
              <input checked={delivery === option.value} disabled={saving} name="whatsapp-delivery" onChange={() => save(option.value)} type="radio" value={option.value} />
              <span>
                <strong>{option.title}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="field-hint">Nos dois modos as credenciais da Meta ficam no SGA (criptografadas). No modo n8n, crie um token com o escopo <code>messaging:send</code> em Configurações → Integrações. Saiba mais em <code>docs/n8n-messaging.md</code>.</p>
      </div>
    </article>
  );
}
