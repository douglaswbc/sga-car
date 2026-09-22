"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { formatPlate, vehicleRegistrationSchema } from "@/features/fleet/vehicle-schema";

type Props = { organizationId: string };
type Values = { plate: string; brand: string; model: string; category: string; modelYear: string; color: string; odometerKm: string };
const initialValues: Values = { plate: "", brand: "", model: "", category: "", modelYear: "", color: "", odometerKm: "0" };

export function VehicleForm({ organizationId }: Readonly<Props>) {
  const router = useRouter(); const { show } = useToast();
  const [open, setOpen] = useState(false); const [values, setValues] = useState<Values>(initialValues); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const update = (field: keyof Values, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const close = () => { setOpen(false); setValues(initialValues); setError(""); };
  const save = async () => { const parsed = vehicleRegistrationSchema.safeParse({ ...values, organizationId, modelYear: values.modelYear || undefined }); if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados."); setSaving(true); setError(""); try { const response = await fetch("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const data: { error?: string } = await response.json(); if (!response.ok) throw new Error(data.error ?? "Não foi possível cadastrar o veículo."); show("Veículo cadastrado na frota."); router.push("/frota"); router.refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o veículo."); setSaving(false); } };
  return <><button className="button" onClick={() => setOpen(true)} type="button">Cadastrar veículo</button>{open ? <Modal onClose={close} title="Novo veículo"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Placa<input autoFocus maxLength={8} onChange={(event) => update("plate", formatPlate(event.target.value))} placeholder="ABC-1D23" value={values.plate} /></label><p className="field-hint">Aceita placas no padrão antigo e Mercosul.</p><label>Marca<input maxLength={60} onChange={(event) => update("brand", event.target.value)} value={values.brand} /></label><label>Modelo<input maxLength={100} onChange={(event) => update("model", event.target.value)} value={values.model} /></label><label>Categoria<input maxLength={60} onChange={(event) => update("category", event.target.value)} placeholder="Moto, hatch, utilitário..." value={values.category} /></label><label>Ano do modelo<input inputMode="numeric" maxLength={4} onChange={(event) => update("modelYear", event.target.value.replace(/\D/g, "").slice(0, 4))} value={values.modelYear} /></label><label>Cor<input maxLength={40} onChange={(event) => update("color", event.target.value)} value={values.color} /></label><label>Quilometragem atual<input inputMode="numeric" onChange={(event) => update("odometerKm", event.target.value.replace(/\D/g, "").slice(0, 7))} value={values.odometerKm} /></label><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar veículo"}</button></div></Modal> : null}</>;
}
