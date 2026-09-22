"use client";

export function PrintButton({ label = "Imprimir / Baixar PDF" }: Readonly<{ label?: string }>) {
  return <button className="button" onClick={() => window.print()} type="button">{label}</button>;
}
