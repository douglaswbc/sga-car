"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { rentalContractUpdateSchema } from "@/features/contracts/contract-schema";
import { ContractFinancials } from "@/features/contracts/contract-financials";
import { ContractRenewals } from "@/features/contracts/contract-renewals";
import { InspectionActions, InspectionStatus } from "@/features/contracts/inspection-actions";
import type { RentalContract } from "@/lib/supabase/types";
type Props = {
    organizationId: string;
    contract: RentalContract;
    canManageOperations?: boolean;
    canManageFinance?: boolean;
};
const frequencies = { daily: "Diária", weekly: "Semanal", fortnightly: "Quinzenal", monthly: "Mensal", custom: "Personalizada" } as const;
const statuses = { active: "Ativo", completed: "Concluído", cancelled: "Cancelado" } as const;
function ContractManager({ organizationId, contract }: Readonly<Props>) {
    const router = useRouter(); const { show } = useToast();
    const [open, setOpen] = useState(false);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [expectedReturnOn, setExpectedReturnOn] = useState(contract.expected_return_on);
    const [dailyRate, setDailyRate] = useState(String(contract.daily_rate));
    const [frequency, setFrequency] = useState<keyof typeof frequencies>(contract.billing_frequency);
    const [billingTime, setBillingTime] = useState(contract.billing_time.slice(0, 5));
    const [customInterval, setCustomInterval] = useState(contract.billing_custom_interval?.toString() ?? "");
    const [customUnit, setCustomUnit] = useState<"day" | "week" | "month">(contract.billing_custom_unit ?? "month");
    const [status, setStatus] = useState<keyof typeof statuses>(contract.status);
    const [actualReturnOn, setActualReturnOn] = useState(contract.actual_return_on ?? "");
    const save = async () => { const parsed = rentalContractUpdateSchema.safeParse({ organizationId, contractId: contract.id, expectedReturnOn, dailyRate, billingFrequency: frequency, billingTime, customInterval: frequency === "custom" ? customInterval : undefined, customUnit: frequency === "custom" ? customUnit : undefined, status, actualReturnOn: status === "active" ? "" : actualReturnOn }); if (!parsed.success)
        return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados."); setSaving(true); setError(""); try {
        const useSettlement = status === "completed" && Boolean(actualReturnOn);
        const response = useSettlement
            ? await fetch(`/api/contracts/${contract.id}/settlement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, actualReturnOn, dueOn: actualReturnOn }) })
            : await fetch(`/api/contracts/${contract.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
        const data: {
            error?: string;
        } = await response.json();
        if (!response.ok)
            throw new Error(data.error ?? "Não foi possível atualizar.");
        show(useSettlement ? "Contrato encerrado com acerto de devolução." : "Contrato atualizado."); router.push("/contratos"); router.refresh();
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível atualizar.");
        setSaving(false);
    } };
    const remove = async () => { if (!window.confirm("Excluir este contrato? Apenas contratos concluídos ou cancelados podem ser excluídos."))
        return; setSaving(true); try {
        const response = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
        const data: {
            error?: string;
        } = await response.json();
        if (!response.ok)
            throw new Error(data.error ?? "Não foi possível excluir.");
        show("Contrato excluído."); router.push("/contratos"); router.refresh();
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível excluir.");
        setSaving(false);
    } };
    const expectedReturn = new Date(`${expectedReturnOn}T00:00:00`);
    const actualReturn = actualReturnOn ? new Date(`${actualReturnOn}T00:00:00`) : null;
    const lateDays = actualReturn ? Math.max(0, Math.round((actualReturn.getTime() - expectedReturn.getTime()) / 86_400_000)) : 0;
    const extraAmount = lateDays * (Number(dailyRate) || Number(contract.daily_rate));
    return <><button className="table-action" onClick={() => setOpen(true)} type="button">Gerenciar</button>{open ? <Modal onClose={() => setOpen(false)} title="Gerenciar locação"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Previsão de retorno<input min={contract.starts_on} onChange={(event) => setExpectedReturnOn(event.target.value)} type="date" value={expectedReturnOn}/></label><label>Valor da diária (R$)<input inputMode="decimal" onChange={(event) => setDailyRate(event.target.value.replace(",", "."))} value={dailyRate}/></label><fieldset className="billing-fields"><legend>Recorrência de cobrança</legend><label>Frequência<select onChange={(event) => setFrequency(event.target.value as keyof typeof frequencies)} value={frequency}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Horário da cobrança<input onChange={(event) => setBillingTime(event.target.value)} type="time" value={billingTime}/></label>{frequency === "custom" ? <><label>Repetir a cada<input inputMode="numeric" onChange={(event) => setCustomInterval(event.target.value.replace(/\D/g, "").slice(0, 3))} value={customInterval}/></label><label>Unidade<select onChange={(event) => setCustomUnit(event.target.value as "day" | "week" | "month")} value={customUnit}><option value="day">dia(s)</option><option value="week">semana(s)</option><option value="month">mês(es)</option></select></label></> : null}</fieldset><label>Status<select onChange={(event) => setStatus(event.target.value as keyof typeof statuses)} value={status}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{status !== "active" ? <label>Data de retorno/encerramento<input onChange={(event) => setActualReturnOn(event.target.value)} type="date" value={actualReturnOn}/></label> : null}{status === "completed" && lateDays > 0 ? <p className="field-hint">Diária excedente: {lateDays} dia(s) · {extraAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} serão cobrados na fatura de acerto.</p> : null}<div className="wizard-actions"><button className="button button--danger" disabled={saving || status === "active"} onClick={remove} type="button">Excluir</button><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar alterações"}</button></div></div></Modal> : null}</>;
}

export function ContractActions({ organizationId, contract, canManageOperations = false, canManageFinance = false }: Readonly<Props>) {
  return <><Link className="table-action" href={`/contratos/${contract.id}/contrato`}>Contrato</Link><InspectionStatus contractId={contract.id} organizationId={organizationId} /><InspectionActions contract={contract} organizationId={organizationId} /><ContractManager contract={contract} organizationId={organizationId} /><ContractFinancials canManageFinance={canManageFinance} canManageOperations={canManageOperations} contract={contract} organizationId={organizationId} /><ContractRenewals canManage={canManageOperations} contract={contract} organizationId={organizationId} /></>;
}
