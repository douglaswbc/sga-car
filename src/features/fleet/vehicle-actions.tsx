"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { formatPlate, vehicleUpdateSchema } from "@/features/fleet/vehicle-schema";
import { VehicleOperations } from "@/features/fleet/vehicle-operations";
import type { Vehicle } from "@/lib/supabase/types";
type Props = {
    organizationId: string;
    vehicle: Vehicle;
};
type Values = {
    plate: string;
    brand: string;
    model: string;
    category: string;
    modelYear: string;
    color: string;
    odometerKm: string;
    status: Vehicle["status"];
};
const statusLabels: Record<Vehicle["status"], string> = { available: "Disponível", rented: "Alugado", maintenance: "Manutenção", inactive: "Inativo" };
function VehicleManager({ organizationId, vehicle }: Readonly<Props>) {
    const router = useRouter(); const { show } = useToast();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [values, setValues] = useState<Values>({ plate: formatPlate(vehicle.plate), brand: vehicle.brand, model: vehicle.model, category: vehicle.category ?? "", modelYear: vehicle.model_year?.toString() ?? "", color: vehicle.color ?? "", odometerKm: vehicle.odometer_km.toString(), status: vehicle.status });
    const update = (field: keyof Values, value: string) => setValues((current) => ({ ...current, [field]: value } as Values));
    const save = async () => { const parsed = vehicleUpdateSchema.safeParse({ ...values, organizationId, vehicleId: vehicle.id, modelYear: values.modelYear || undefined }); if (!parsed.success)
        return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados."); setSaving(true); setError(""); try {
        const response = await fetch(`/api/vehicles/${vehicle.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
        const data: {
            error?: string;
        } = await response.json();
        if (!response.ok)
            throw new Error(data.error ?? "Não foi possível atualizar.");
        show("Veículo atualizado."); router.push("/frota"); router.refresh();
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível atualizar.");
        setSaving(false);
    } };
    const remove = async () => { if (!window.confirm(`Excluir ${vehicle.brand} ${vehicle.model} da frota? Esta ação não pode ser desfeita.`))
        return; setSaving(true); try {
        const response = await fetch(`/api/vehicles/${vehicle.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
        const data: {
            error?: string;
        } = await response.json();
        if (!response.ok)
            throw new Error(data.error ?? "Não foi possível excluir.");
        show("Veículo excluído da frota."); router.push("/frota"); router.refresh();
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível excluir.");
        setSaving(false);
    } };
    return <><button className="table-action" onClick={() => setOpen(true)} type="button">Gerenciar</button>{open ? <Modal onClose={() => setOpen(false)} title="Gerenciar veículo"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Placa<input maxLength={8} onChange={(event) => update("plate", formatPlate(event.target.value))} value={values.plate}/></label><label>Marca<input maxLength={60} onChange={(event) => update("brand", event.target.value)} value={values.brand}/></label><label>Modelo<input maxLength={100} onChange={(event) => update("model", event.target.value)} value={values.model}/></label><label>Categoria<input maxLength={60} onChange={(event) => update("category", event.target.value)} value={values.category}/></label><label>Ano do modelo<input inputMode="numeric" maxLength={4} onChange={(event) => update("modelYear", event.target.value.replace(/\D/g, "").slice(0, 4))} value={values.modelYear}/></label><label>Cor<input maxLength={40} onChange={(event) => update("color", event.target.value)} value={values.color}/></label><label>Quilometragem atual<input inputMode="numeric" onChange={(event) => update("odometerKm", event.target.value.replace(/\D/g, "").slice(0, 7))} value={values.odometerKm}/></label><label>Status<select onChange={(event) => update("status", event.target.value)} value={values.status}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="wizard-actions"><button className="button button--danger" disabled={saving} onClick={remove} type="button">Excluir</button><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar alterações"}</button></div></div></Modal> : null}</>;
}

export function VehicleActions({ organizationId, vehicle }: Readonly<Props>) {
  return <><VehicleOperations organizationId={organizationId} vehicle={vehicle} /><VehicleManager organizationId={organizationId} vehicle={vehicle} /></>;
}
