"use client";

import { useRouter } from "next/navigation";

type ExportRow = { tenant: string; vehicle: string; due: string; amount: string; status: string };

export function DashboardControls({ startsOn, endsOn, rows }: Readonly<{ startsOn: string; endsOn: string; rows: ExportRow[] }>) {
  const router = useRouter();
  function updatePeriod(formData: FormData) {
    const starts = String(formData.get("starts_on") ?? "");
    const ends = String(formData.get("ends_on") ?? "");
    if (starts && ends && starts <= ends) router.push(`/?starts_on=${starts}&ends_on=${ends}`);
  }
  function exportCsv() {
    const content = [["Locatário", "Veículo", "Vencimento", "Valor", "Status"], ...rows.map((row) => [row.tenant, row.vehicle, row.due, row.amount, row.status])]
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `relatorio-sga-${startsOn}-${endsOn}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="dashboard-controls">
    <form action={updatePeriod} className="filter-form">
      <label>De <input aria-label="Data inicial" defaultValue={startsOn} name="starts_on" required type="date" /></label>
      <label>Até <input aria-label="Data final" defaultValue={endsOn} name="ends_on" min={startsOn} onChange={(event) => event.currentTarget.form?.requestSubmit()} required type="date" /></label>
    </form>
    <button className="button button--secondary" onClick={exportCsv} type="button">Exportar CSV</button>
    <button className="button button--secondary" onClick={() => window.print()} type="button">Imprimir / PDF</button>
  </div>;
}
