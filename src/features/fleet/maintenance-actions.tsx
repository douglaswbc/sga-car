"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
export function MaintenanceActions({organizationId,maintenanceId,odometerKm}:{organizationId:string;maintenanceId:string;odometerKm:number}) {
 const router=useRouter();const {show}=useToast();const [open,setOpen]=useState(false);const [saving,setSaving]=useState(false);const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [km,setKm]=useState(String(odometerKm));const [error,setError]=useState("");
 const send=async(status:"completed"|"cancelled")=>{setSaving(true);setError("");const r=await fetch("/api/vehicles/maintenance/"+maintenanceId,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId,status,completedOn:date,completedOdometerKm:km})});const d:{error?:string}=await r.json();if(!r.ok){setError(d.error??"Não foi possível atualizar.");setSaving(false);return;}setOpen(false);setSaving(false);show(status==="completed"?"Manutenção concluída.":"Manutenção cancelada.");router.refresh();};
 return <><button className="table-action" onClick={()=>setOpen(true)} type="button">Atualizar</button>{open?<Modal onClose={()=>setOpen(false)} title="Manutenção"><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields"><label>Data de conclusão<input onChange={e=>setDate(e.target.value)} type="date" value={date}/></label><label>Quilometragem final<input onChange={e=>setKm(e.target.value.replace(/\D/g,""))} value={km}/></label><button className="button" disabled={saving} onClick={()=>send("completed")} type="button">{saving?"Salvando...":"Concluir manutenção"}</button><button className="button button--danger" disabled={saving} onClick={()=>send("cancelled")} type="button">Cancelar manutenção</button></div></Modal>:null}</>;
}
