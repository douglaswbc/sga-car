"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { inspectionSchema } from "@/features/contracts/inspection-schema";
import type { ContractInspection, RentalContract } from "@/lib/supabase/types";

type Props = { organizationId: string; contract: RentalContract };
const today = () => new Date().toISOString().slice(0, 10);
const number = (value: string) => Number(value || 0);

export function InspectionStatus({ organizationId, contractId }: Readonly<{ organizationId: string; contractId: string }>) {
  const [inspections, setInspections] = useState<ContractInspection[]>([]);
  useEffect(() => {
    void fetch("/api/contracts/" + contractId + "/inspections?organizationId=" + encodeURIComponent(organizationId))
      .then(async (response) => response.ok ? response.json() as Promise<{ inspections?: ContractInspection[] }> : { inspections: [] })
      .then((data) => setInspections(data.inspections ?? []));
  }, [contractId, organizationId]);
  const pickup = inspections.find((inspection) => inspection.type === "pickup"); const returned = inspections.find((inspection) => inspection.type === "return");
  if (!pickup) return <span className="inspection-status">Sem retirada</span>;
  if (!returned) return <span className="inspection-status inspection-status--pickup">Retirada registrada</span>;
  const km = Math.max(0, returned.odometer_km - pickup.odometer_km); const damageCost = Number(returned.damage_cost);
  return <span className="inspection-status inspection-status--return">Devolução · +{km.toLocaleString("pt-BR")} km · {damageCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>;
}

export function InspectionActions({ organizationId, contract }: Readonly<Props>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inspections, setInspections] = useState<ContractInspection[]>([]);
  const [type, setType] = useState<"pickup" | "return">("pickup");
  const [inspectedOn, setInspectedOn] = useState(today());
  const [odometerKm, setOdometerKm] = useState("");
  const [fuelLevel, setFuelLevel] = useState("");
  const [accessories, setAccessories] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [notes, setNotes] = useState("");
  const [damageDescription, setDamageDescription] = useState("");
  const [damageCost, setDamageCost] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pickup = inspections.find((inspection) => inspection.type === "pickup");
  const existingReturn = inspections.find((inspection) => inspection.type === "return");
  const kmDifference = pickup && type === "return" ? Math.max(0, number(odometerKm) - pickup.odometer_km) : null;
  const fuelDifference = pickup && type === "return" ? number(fuelLevel) - pickup.fuel_level : null;

  const fill = (inspection: ContractInspection | undefined) => {
    setInspectedOn(inspection?.inspected_on ?? today());
    setOdometerKm(inspection ? String(inspection.odometer_km) : "");
    setFuelLevel(inspection ? String(inspection.fuel_level) : "");
    setAccessories(inspection?.accessories.join(", ") ?? "");
    setPhotoUrls(inspection?.photo_urls.join("\n") ?? "");
    setNotes(inspection?.notes ?? "");
  };
  const selectType = (next: "pickup" | "return") => { setType(next); fill(next === "pickup" ? pickup : existingReturn); };
  const show = async () => {
    setError("");
    const response = await fetch("/api/contracts/" + contract.id + "/inspections?organizationId=" + encodeURIComponent(organizationId));
    const data: { inspections?: ContractInspection[]; error?: string } = await response.json();
    if (!response.ok) { setError(data.error ?? "Não foi possível carregar as vistorias."); setOpen(true); return; }
    const records = data.inspections ?? []; setInspections(records);
    const savedPickup = records.find((inspection) => inspection.type === "pickup");
    const savedReturn = records.find((inspection) => inspection.type === "return");
    const nextType = savedPickup ? "return" : "pickup"; setType(nextType);
    const current = nextType === "pickup" ? savedPickup : savedReturn; fill(current);
    setOpen(true);
  };
  const save = async () => {
    const damages = damageDescription.trim() ? [{ description: damageDescription, estimatedCost: damageCost || 0 }] : [];
    const body = { organizationId, contractId: contract.id, type, inspectedOn, odometerKm, fuelLevel, accessories: accessories.split(",").map((item) => item.trim()).filter(Boolean), photoUrls: photoUrls.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), notes, damages };
    const parsed = inspectionSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados.");
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/contracts/" + contract.id + "/inspections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar a vistoria.");
      setOpen(false); setSaving(false); router.push("/contratos?notice=Vistoria salva."); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a vistoria."); setSaving(false); }
  };

  return <><button className="table-action" onClick={() => void show()} type="button">Vistoriar</button>{open ? <Modal onClose={() => setOpen(false)} title="Vistoria"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Tipo<select onChange={(event) => selectType(event.target.value as "pickup" | "return")} value={type}><option value="pickup">Retirada</option><option disabled={!pickup} value="return">Devolução</option></select></label>{type === "return" && pickup ? <p className="field-hint">Retirada: {pickup.odometer_km.toLocaleString("pt-BR")} km · combustível {pickup.fuel_level}% · {pickup.damage_count} avaria(s) · custo {Number(pickup.damage_cost).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.</p> : null}<label>Data da vistoria<input onChange={(event) => setInspectedOn(event.target.value)} type="date" value={inspectedOn} /></label><label>Quilometragem (km)<input inputMode="numeric" min={type === "return" ? pickup?.odometer_km : 0} onChange={(event) => setOdometerKm(event.target.value.replace(/\D/g, ""))} value={odometerKm} /></label>{kmDifference !== null ? <p className="field-hint">Diferença de quilometragem: +{kmDifference.toLocaleString("pt-BR")} km.</p> : null}<label>Combustível (%)<input inputMode="numeric" max="100" min="0" onChange={(event) => setFuelLevel(event.target.value.replace(/\D/g, ""))} value={fuelLevel} /></label>{fuelDifference !== null ? <p className="field-hint">Diferença de combustível: {fuelDifference > 0 ? "+" : ""}{fuelDifference}%.</p> : null}<label>Acessórios (separe por vírgulas)<input onChange={(event) => setAccessories(event.target.value)} value={accessories} /></label><label>URLs das fotos (uma por linha)<textarea onChange={(event) => setPhotoUrls(event.target.value)} value={photoUrls} /></label><label>Avaria encontrada (opcional)<input onChange={(event) => setDamageDescription(event.target.value)} value={damageDescription} /></label><label>Custo estimado da avaria (R$)<input inputMode="decimal" onChange={(event) => setDamageCost(event.target.value.replace(",", "."))} value={damageCost} /></label><label>Observações<textarea onChange={(event) => setNotes(event.target.value)} value={notes} /></label><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar vistoria"}</button></div></Modal> : null}</>;
}
