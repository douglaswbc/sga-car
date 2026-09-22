"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import type { ContractFee, RentalContract } from "@/lib/supabase/types";

const depositLabels: Record<RentalContract["security_deposit_status"], string> = { none: "Sem caução", pending: "Pendente de cobrança", held: "Em garantia", refunded: "Devolvida", retained: "Retida (utilizada)" };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = { organizationId: string; contract: RentalContract; canManageOperations: boolean; canManageFinance: boolean };

export function ContractFinancials({ organizationId, contract, canManageOperations, canManageFinance }: Readonly<Props>) {
  const router = useRouter(); const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [deposit, setDeposit] = useState(String(contract.security_deposit_amount ?? 0));
  const [fees, setFees] = useState<ContractFee[]>([]);
  const [feeName, setFeeName] = useState(""); const [feeAmount, setFeeAmount] = useState(""); const [feeRecurrence, setFeeRecurrence] = useState<"one_time" | "recurring">("recurring");
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);

  const loadFees = useCallback(async () => {
    const response = await fetch(`/api/contracts/${contract.id}/fees?organizationId=${organizationId}`);
    const data: { fees?: ContractFee[] } = await response.json().catch(() => ({}));
    if (response.ok) setFees(data.fees ?? []);
  }, [contract.id, organizationId]);

  const openModal = () => { setOpen(true); void loadFees(); };

  const request = async (url: string, method: string, body: object, successMessage: string) => {
    setSaving(true); setError("");
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data: { error?: string } = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível concluir a operação."); return false; }
    show(successMessage); router.refresh(); return true;
  };

  const saveDeposit = async () => {
    const amount = Number(deposit || 0);
    if (await request(`/api/contracts/${contract.id}/deposit`, "PUT", { organizationId, amount }, "Caução atualizada.")) setDeposit(String(amount));
  };
  const chargeDeposit = () => request(`/api/contracts/${contract.id}/deposit`, "POST", { organizationId, action: "charge", dueOn: new Date().toISOString().slice(0, 10) }, "Cobrança de caução gerada.");
  const settleDeposit = (resolution: "refunded" | "retained") => request(`/api/contracts/${contract.id}/deposit`, "POST", { organizationId, action: "settle", resolution }, resolution === "refunded" ? "Devolução da caução registrada." : "Retenção da caução registrada.");
  const addFee = async () => {
    if (await request(`/api/contracts/${contract.id}/fees`, "POST", { organizationId, name: feeName, amount: feeAmount, recurrence: feeRecurrence }, "Taxa adicionada.")) {
      setFeeName(""); setFeeAmount(""); await loadFees();
    }
  };
  const removeFee = async (feeId: string) => {
    if (await request(`/api/contracts/${contract.id}/fees`, "DELETE", { organizationId, feeId }, "Taxa removida.")) await loadFees();
  };

  return <>
    <button className="table-action" onClick={openModal} type="button">Caução e taxas</button>
    {open ? <Modal onClose={() => setOpen(false)} title="Caução e taxas do contrato">
      <FormMessage tone="error">{error}</FormMessage>
      <div className="wizard-fields">
        <fieldset className="billing-fields"><legend>Caução</legend>
          <p className="field-hint">Situação: <strong>{depositLabels[contract.security_deposit_status]}</strong> · {money(Number(contract.security_deposit_amount ?? 0))}</p>
          {canManageOperations ? <label>Valor da caução (R$)<input inputMode="decimal" onChange={(event) => setDeposit(event.target.value.replace(",", "."))} value={deposit} /></label> : null}
          {canManageOperations ? <button className="button button--secondary" disabled={saving} onClick={saveDeposit} type="button">Salvar caução</button> : null}
          {canManageFinance && Number(contract.security_deposit_amount) > 0 && contract.security_deposit_status !== "held" ? <button className="button" disabled={saving} onClick={chargeDeposit} type="button">Cobrar caução</button> : null}
          {canManageFinance && contract.security_deposit_status === "held" ? <div className="connection-actions"><button className="button button--secondary" disabled={saving} onClick={() => settleDeposit("refunded")} type="button">Registrar devolução</button><button className="button button--danger" disabled={saving} onClick={() => settleDeposit("retained")} type="button">Reter caução</button></div> : null}
        </fieldset>
        {canManageOperations ? <fieldset className="billing-fields"><legend>Taxas próprias</legend>
          {fees.length ? <ul className="asset-list">{fees.map((fee) => <li key={fee.id}>{fee.name} · {money(Number(fee.amount))} · {fee.recurrence === "recurring" ? "por período" : "única"}<button className="table-action table-action--danger" disabled={saving} onClick={() => removeFee(fee.id)} type="button">Remover</button></li>)}</ul> : <p className="field-hint">Nenhuma taxa cadastrada.</p>}
          <label>Nome da taxa<input maxLength={120} onChange={(event) => setFeeName(event.target.value)} value={feeName} /></label>
          <label>Valor (R$)<input inputMode="decimal" onChange={(event) => setFeeAmount(event.target.value.replace(",", "."))} value={feeAmount} /></label>
          <label>Recorrência<select onChange={(event) => setFeeRecurrence(event.target.value as "one_time" | "recurring")} value={feeRecurrence}><option value="recurring">A cada período</option><option value="one_time">Cobrança única</option></select></label>
          <button className="button" disabled={saving || !feeName || !feeAmount} onClick={addFee} type="button">Adicionar taxa</button>
        </fieldset> : null}
      </div>
    </Modal> : null}
  </>;
}
