import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SGA | Gestão de aluguel",
  description: "Sistema de Gestão de Aluguel",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
