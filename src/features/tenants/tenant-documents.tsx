"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { Modal } from "@/components/modal";
import { formatCnh, tenantDocumentSchema } from "@/features/tenants/tenant-schema";
import type { TenantDocument } from "@/lib/supabase/types";

type Props = { organizationId: string; tenantId: string; canManage: boolean; documents: TenantDocument[] };
const documentTypes: Record<TenantDocument["type"], string> = { cnh: "CNH", proof_of_address: "Comprovante", other: "Outro" };
const otherTypes = ["proof_of_address", "other"] as const;
type OtherType = (typeof otherTypes)[number];
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function TenantDocuments({ organizationId, tenantId, canManage, documents }: Readonly<Props>) {
  const router = useRouter();
  const cnh = documents.find((document) => document.type === "cnh");
  const others = documents.filter((document) => document.type !== "cnh");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"cnh" | "other">("other");
  const [type, setType] = useState<OtherType>("proof_of_address");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [category, setCategory] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const close = () => { setOpen(false); setError(""); setName(""); setUrl(""); setIdentifier(""); setCategory(""); setExpiresOn(""); };
  const start = (next: "cnh" | "other") => { setKind(next); setError(""); setOpen(true); };

  const save = async () => {
    const payload = kind === "cnh"
      ? { organizationId, tenantId, type: "cnh", name: name || "CNH", url, identifier, category, expiresOn }
      : { organizationId, tenantId, type, name, url, identifier: "", category: "", expiresOn };
    const parsed = tenantDocumentSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revise os dados informados.");
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/tenants/${tenantId}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data: { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o documento.");
      close();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o documento.");
      setSaving(false);
    }
  };

  const remove = async (documentId: string) => {
    if (!window.confirm("Remover este documento?")) return;
    const response = await fetch(`/api/tenants/${tenantId}/documents/${documentId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
    if (response.ok) return router.refresh();
    const data: { error?: string } = await response.json();
    setError(data.error ?? "Não foi possível remover o documento.");
  };

  return <section className="vehicle-assets">
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Habilitação (CNH)</h2><p>Valida a elegibilidade do locatário para locação.</p></div>{canManage && !cnh ? <button className="button button--secondary" onClick={() => start("cnh")} type="button">Adicionar CNH</button> : null}</header>{cnh ? <div className="table-wrap"><table><thead><tr><th>Número</th><th>Categoria</th><th>Validade</th><th>Anexo</th>{canManage ? <th><span className="sr-only">Ação</span></th> : null}</tr></thead><tbody><tr><td><strong>{cnh.identifier ?? "—"}</strong></td><td>{cnh.category ?? "—"}</td><td>{cnh.expires_on ? date(cnh.expires_on) : "—"}</td><td>{cnh.url ? <a className="table-action" href={cnh.url} rel="noreferrer" target="_blank">Ver</a> : "—"}</td>{canManage ? <td><button className="table-action table-action--danger" onClick={() => remove(cnh.id)} type="button">Remover</button></td> : null}</tr></tbody></table></div> : <p className="empty-state">Nenhuma CNH cadastrada.</p>}</article>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Documentos e anexos</h2><p>Comprovantes e outros documentos do locatário.</p></div>{canManage ? <button className="button button--secondary" onClick={() => start("other")} type="button">Adicionar documento</button> : null}</header>{others.length ? <div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Documento</th><th>Validade</th>{canManage ? <th><span className="sr-only">Ação</span></th> : null}</tr></thead><tbody>{others.map((document) => <tr key={document.id}><td>{documentTypes[document.type]}</td><td>{document.url ? <a className="table-action" href={document.url} rel="noreferrer" target="_blank">{document.name}</a> : document.name}</td><td>{document.expires_on ? date(document.expires_on) : "—"}</td>{canManage ? <td><button className="table-action table-action--danger" onClick={() => remove(document.id)} type="button">Remover</button></td> : null}</tr>)}</tbody></table></div> : <p className="empty-state">Nenhum documento cadastrado.</p>}</article>
    {error && !open ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    {open ? <Modal onClose={close} title={kind === "cnh" ? "Adicionar CNH" : "Adicionar documento"}><FormMessage tone="error">{error}</FormMessage><div className="wizard-fields">{kind === "cnh" ? <><label>Número da CNH<input inputMode="numeric" maxLength={11} onChange={(event) => setIdentifier(formatCnh(event.target.value))} value={identifier} /></label><label>Categoria<input maxLength={5} onChange={(event) => setCategory(event.target.value.toUpperCase())} placeholder="Ex.: AB" value={category} /></label><label>Validade<input onChange={(event) => setExpiresOn(event.target.value)} type="date" value={expiresOn} /></label></> : <><label>Tipo<select onChange={(event) => setType(event.target.value as OtherType)} value={type}>{otherTypes.map((value) => <option key={value} value={value}>{documentTypes[value]}</option>)}</select></label><label>Nome<input maxLength={120} onChange={(event) => setName(event.target.value)} value={name} /></label><label>Validade (opcional)<input onChange={(event) => setExpiresOn(event.target.value)} type="date" value={expiresOn} /></label></>}<label>URL do anexo (opcional)<input maxLength={500} onChange={(event) => setUrl(event.target.value)} placeholder="https://" type="url" value={url} /></label><div className="wizard-actions"><button className="button button--secondary" disabled={saving} onClick={close} type="button">Cancelar</button><button className="button" disabled={saving} onClick={save} type="button">{saving ? "Salvando..." : "Salvar"}</button></div></div></Modal> : null}
  </section>;
}
