"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { ContractRenewal, RentalContract } from "@/lib/supabase/types";

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ContractRenewals({ organizationId, contract, canManage }: Readonly<{ organizationId: string; contract: RentalContract; canManage: boolean }>) {
  const router = useRouter(); const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [renewals, setRenewals] = useState<ContractRenewal[]>([]);
  const [newReturnOn, setNewReturnOn] = useState(contract.expected_return_on);
  const [newDailyRate, setNewDailyRate] = useState("");
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);

  const loadRenewals = async () => {
    const response = await fetch(`/api/contracts/${contract.id}/renewals?organizationId=${organizationId}`);
    const data: { renewals?: ContractRenewal[] } = await response.json().catch(() => ({}));
    if (response.ok) setRenewals(data.renewals ?? []);
  };
  const openModal = () => { setOpen(true); void loadRenewals(); };

  const extend = async () => {
    if (newReturnOn <= contract.expected_return_on) { setError("A nova data deve ser posterior à previsão atual."); return; }
    setSaving(true); setError("");
    const response = await fetch(`/api/contracts/${contract.id}/renewals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, newReturnOn, newDailyRate: newDailyRate ? newDailyRate.replace(",", ".") : undefined }),
    });
    const data: { error?: string } = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível prorrogar o contrato."); return; }
    show("Contrato prorrogado."); await loadRenewals(); router.refresh();
  };

  if (!canManage) return null;

  return <>
    <button className="table-action" onClick={openModal} type="button">Prorrogar</button>
    {open ? <Modal onClose={() => setOpen(false)} title="Prorrogar contrato">
      <FormMessage tone="error">{error}</FormMessage>
      <div className="wizard-fields">
        <p className="field-hint">Previsão atual: <strong>{date(contract.expected_return_on)}</strong> · diária {money(Number(contract.daily_rate))}</p>
        <label>Nova previsão de retorno<input min={contract.expected_return_on} onChange={(event) => setNewReturnOn(event.target.value)} type="date" value={newReturnOn} /></label>
        <label>Nova diária (opcional)<input inputMode="decimal" onChange={(event) => setNewDailyRate(event.target.value.replace(",", "."))} placeholder="Mantém a atual" value={newDailyRate} /></label>
        <button className="button" disabled={saving} onClick={extend} type="button">{saving ? "Prorrogando..." : "Confirmar prorrogação"}</button>
        <fieldset className="billing-fields"><legend>Histórico ({renewals.length})</legend>
          {renewals.length ? <ul className="asset-list">{renewals.map((renewal) => <li key={renewal.id}>{date(renewal.previous_return_on)} → {date(renewal.new_return_on)}{Number(renewal.previous_daily_rate) !== Number(renewal.new_daily_rate) ? ` · diária ${money(Number(renewal.previous_daily_rate))} → ${money(Number(renewal.new_daily_rate))}` : ""}</li>)}</ul> : <p className="field-hint">Nenhuma prorrogação registrada.</p>}
        </fieldset>
      </div>
    </Modal> : null}
  </>;
}
