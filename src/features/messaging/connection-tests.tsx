"use client";

import { useState } from "react";
import type { MessagingConfigStatus } from "@/lib/messaging/diagnostics";

type WhatsAppResult = { ok: true; phoneNumberId: string; displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string } | { ok: false; error: string; code?: number };
type ResendResult = { ok: true; domains: { name: string; status: string }[]; senderStatus?: string } | { ok: false; error: string };
type SendResult = { ok: true; id?: string } | { ok: false; error: string };

function Check({ label, present }: Readonly<{ label: string; present: boolean }>) {
  return <p className={present ? "field-valid" : "field-invalid"}>{present ? "✓" : "✗"} {label}</p>;
}

export function ConnectionTests({ config }: Readonly<{ config: MessagingConfigStatus }>) {
  const [metaRunning, setMetaRunning] = useState(false);
  const [metaResult, setMetaResult] = useState<WhatsAppResult | null>(null);
  const [emailRunning, setEmailRunning] = useState(false);
  const [emailResult, setEmailResult] = useState<ResendResult | null>(null);
  const [to, setTo] = useState("");
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const metaReady = config.meta.accessToken && config.meta.phoneNumberId;
  const [webhookCopied, setWebhookCopied] = useState(false);
  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(config.meta.webhookUrl);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      // Cópia manual caso o navegador bloqueie.
    }
  };

  const testMeta = async () => {
    setMetaRunning(true);
    setMetaResult(null);
    const response = await fetch("/api/messaging/whatsapp/test", { method: "POST" });
    const data: { result?: WhatsAppResult; error?: string } = await response.json();
    setMetaRunning(false);
    setMetaResult(data.result ?? { ok: false, error: data.error ?? "Falha no teste." });
  };

  const verifyEmail = async () => {
    setEmailRunning(true);
    setEmailResult(null);
    setSendResult(null);
    const response = await fetch("/api/messaging/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data: { verification?: ResendResult; error?: string } = await response.json();
    setEmailRunning(false);
    setEmailResult(data.verification ?? { ok: false, error: data.error ?? "Falha no teste." });
  };

  const sendEmailTest = async () => {
    setEmailRunning(true);
    setSendResult(null);
    const response = await fetch("/api/messaging/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
    const data: { verification?: ResendResult; result?: SendResult; error?: string } = await response.json();
    setEmailRunning(false);
    if (data.verification) setEmailResult(data.verification);
    setSendResult(data.result ?? { ok: false, error: data.error ?? "Falha ao enviar." });
  };

  return <>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Meta WhatsApp</h2><p>Teste somente leitura: valida o token e o número, sem enviar mensagens.</p></div></header><div className="connection-body"><div className="config-checklist"><Check label="Access token" present={config.meta.accessToken} /><Check label="Phone number ID" present={config.meta.phoneNumberId} /><Check label="Verify token (webhook)" present={config.meta.verifyToken} /><Check label="App secret (assinatura)" present={config.meta.appSecret} /><p className="field-hint">Graph API {config.meta.graphVersion}</p></div><div className="config-checklist"><p className="field-hint">Webhook (Meta → WhatsApp → Configuration): assine o evento <code>messages</code> e informe a URL abaixo.</p><div className="connection-actions"><code className="webhook-url">{config.meta.webhookUrl}</code><button className="button button--secondary" onClick={copyWebhook} type="button">{webhookCopied ? "Copiado!" : "Copiar URL"}</button></div><p className={config.meta.verifyToken ? "field-valid" : "field-invalid"}>{config.meta.verifyToken ? "✓" : "✗"} Verify token {config.meta.verifyToken ? "configurado (META_WHATSAPP_VERIFY_TOKEN)." : "ausente (defina META_WHATSAPP_VERIFY_TOKEN)."}</p></div><button className="button" disabled={!metaReady || metaRunning} onClick={testMeta} type="button">{metaRunning ? "Testando..." : "Testar conexão"}</button>{metaResult ? metaResult.ok ? <p className="form-message form-message--notice" role="status">Conectado: {metaResult.displayPhoneNumber ?? metaResult.phoneNumberId}{metaResult.verifiedName ? ` · ${metaResult.verifiedName}` : ""}{metaResult.qualityRating ? ` · Qualidade ${metaResult.qualityRating}` : ""}</p> : <p className="form-message form-message--error" role="alert">Falha: {metaResult.error}{metaResult.code ? ` (código ${metaResult.code})` : ""}</p> : null}</div></article>

    <article className="panel admin-panel"><header className="panel-header"><div><h2>E-mail (Resend)</h2><p>Valida a chave pelo catálogo de domínios e permite enviar um e-mail de teste.</p></div></header><div className="connection-body"><div className="config-checklist"><Check label="API key" present={config.email.apiKey} /><p className={config.email.from ? "field-valid" : "field-invalid"}>{config.email.from ? "✓" : "✗"} Remetente: {config.email.senderAddress || "SGA_EMAIL_FROM ausente"}{config.email.from && !config.email.senderAddress ? ` (${config.email.from})` : ""}</p><Check label="Reply-to (opcional)" present={config.email.replyTo} /></div>{config.email.ready ? <p className="form-message form-message--notice" role="status">Configuração pronta. Valide a chave para confirmar que o domínio do remetente está verificado.</p> : <p className="form-message form-message--error" role="alert">Configuração incompleta: defina {config.email.missing.join(", ")} para habilitar o envio.</p>}<div className="connection-actions"><button className="button button--secondary" disabled={!config.email.apiKey || emailRunning} onClick={verifyEmail} type="button">{emailRunning ? "Verificando..." : "Validar chave"}</button><input maxLength={254} onChange={(event) => setTo(event.target.value)} placeholder="destino@exemplo.com" type="email" value={to} /><button className="button" disabled={!config.email.apiKey || emailRunning || !to} onClick={sendEmailTest} type="button">Enviar teste</button></div>{emailResult ? emailResult.ok ? <p className="form-message form-message--notice" role="status">Chave válida. {emailResult.domains.length} domínio(s).{emailResult.senderStatus ? ` Remetente: ${emailResult.senderStatus}.` : ""}</p> : <p className="form-message form-message--error" role="alert">Falha: {emailResult.error}</p> : null}{emailResult?.ok && emailResult.domains.length ? <ul className="asset-list">{emailResult.domains.map((domain) => <li key={domain.name}>{domain.name} — {domain.status}</li>)}</ul> : null}{sendResult ? sendResult.ok ? <p className="form-message form-message--notice" role="status">E-mail de teste enviado{sendResult.id ? ` (id ${sendResult.id})` : ""}.</p> : <p className="form-message form-message--error" role="alert">Falha ao enviar: {sendResult.error}</p> : null}</div></article>
  </>;
}
