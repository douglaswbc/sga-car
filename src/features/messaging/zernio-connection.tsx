"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { useToast } from "@/components/toast";

type Connection = { account_id: string; display_name: string | null; profile_id: string | null } | null;
type DiscoveredAccount = { accountId: string; displayName: string | null; profile: string | null; active: boolean };
type TestResult = { ok: true; accountId: string; displayName: string | null; active: boolean; profile: string | null } | { ok: false; error: string };
type SyncResult = { ok: boolean; submitted?: number; synchronized?: number; failures?: string[]; error?: string };
type WebhookState = { registered: boolean; registeredAt: Date | string | null; events: string[]; supportedEvents: readonly string[]; url: string | null };

export function ZernioConnection({ organizationId, connection, webhook }: Readonly<{ organizationId: string; connection: Connection; webhook: WebhookState | null }>) {
  const router = useRouter();
  const { show } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState(connection?.account_id ?? "");
  const [accounts, setAccounts] = useState<DiscoveredAccount[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookState, setWebhookState] = useState(webhook);

  const configured = Boolean(connection);
  const keySaved = Boolean(connection);

  const loadWebhook = useCallback(async () => {
    const response = await fetch(`/api/messaging/zernio/webhook?organizationId=${organizationId}`);
    if (!response.ok) return;
    setWebhookState((await response.json()) as WebhookState);
  }, [organizationId]);

  const discover = async () => {
    setDiscovering(true); setError(""); setNotice("");
    setShowOnboarding(false);
    const response = await fetch("/api/messaging/zernio/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, apiKey }),
    });
    const data: { accounts?: DiscoveredAccount[]; error?: string } = await response.json();
    setDiscovering(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível consultar as contas."); return; }
    const found = data.accounts ?? [];
    setAccounts(found);
    if (found.length === 0) { setShowOnboarding(true); setNotice("Sua API key está válida. Vamos conectar um número de WhatsApp agora."); return; }
    if (found.length === 1) { setAccountId(found[0].accountId); setNotice("Conta de WhatsApp encontrada e selecionada."); }
    else setNotice(`${found.length} contas de WhatsApp encontradas. Selecione a que o SGA deve usar.`);
  };

  const save = async () => {
    setSaving(true); setError(""); setNotice(""); setTestResult(null);
    const response = await fetch("/api/messaging/zernio/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, accountId, apiKey }),
    });
    const data: { displayName?: string | null; error?: string } = await response.json();
    setSaving(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível salvar a conexão."); return; }
    // A chave nunca é reenviada ao navegador depois de salva.
    setApiKey("");
    setAccounts([]);
    show("Conexão do Zernio salva.");
    router.refresh();
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    const response = await fetch("/api/messaging/zernio/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    const data: { result?: TestResult; error?: string } = await response.json();
    setTesting(false);
    setTestResult(data.result ?? { ok: false, error: data.error ?? "Falha no teste." });
  };

  const sync = async (direction: "push" | "pull") => {
    setSyncBusy(true); setSyncResult(null); setError("");
    const response = await fetch("/api/messaging/zernio/templates/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, organizationId }),
    });
    const data: SyncResult = await response.json();
    setSyncBusy(false);
    setSyncResult(data);
    router.refresh();
  };

  /**
   * Abre a tela da Zernio, que hospeda o Embedded Signup da Meta dentro dela. O retorno vem
   * por callback no servidor e o navegador volta para /comunicacao/canais com o resultado,
   * então aqui só é preciso navegar.
   */
  const connect = async () => {
    setConnecting(true); setError(""); setNotice("");
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const response = await fetch("/api/messaging/zernio/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, brandName: "SGA", apiKey: showOnboarding || !configured ? apiKey : undefined, returnTo }),
    });
    const data: { authUrl?: string; error?: string } = await response.json();
    setConnecting(false);
    if (!response.ok || !data.authUrl) { setError(data.error ?? "Não foi possível iniciar a conexão."); return; }
    window.location.assign(data.authUrl);
  };

  const manageWebhook = async (action: "register" | "unregister") => {
    setWebhookBusy(true); setError("");
    const response = await fetch("/api/messaging/zernio/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, action }),
    });
    const data: { error?: string } = await response.json();
    setWebhookBusy(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível atualizar o webhook."); return; }
    show(action === "register" ? "Webhook registrado." : "Webhook removido.");
    await loadWebhook();
    router.refresh();
  };

  return (
    <article className="panel admin-panel">
      <header className="panel-header">
        <div>
          <h2>WhatsApp via Zernio</h2>
          <p>A organização usa a própria API key da Zernio. A chave fica criptografada no banco e nunca é exposta ao navegador.</p>
        </div>
        <span className={`status status--${configured ? "success" : "neutral"}`}><span aria-hidden="true" />{configured ? "Configurado" : "Não configurado"}</span>
      </header>

      <div className="connection-body zernio-connection-body">
        <FormMessage tone="error">{error}</FormMessage>
        <FormMessage tone="notice">{notice}</FormMessage>

        <label className="field">
          <span>API key do Zernio</span>
          <input autoComplete="off" onChange={(event) => { setApiKey(event.target.value); setAccounts([]); setShowOnboarding(false); setNotice(""); setError(""); }} placeholder={configured ? "Informe uma nova chave para substituí-la" : "zn_..."} type="password" value={apiKey} />
        </label>
        <div className="connection-actions">
          <button className="button button--secondary" disabled={!apiKey || discovering} onClick={discover} type="button">{discovering ? "Consultando..." : "Buscar contas"}</button>
        </div>
        <p className="field-hint">A busca valida a chave e lista as contas de WhatsApp, para você não precisar descobrir o ID manualmente.</p>

        {accounts.length ? (
          <div className="choice-list">
            {accounts.map((account) => (
              <label className={`choice${accountId === account.accountId ? " choice--selected" : ""}`} key={account.accountId}>
                <input checked={accountId === account.accountId} name="zernio-account" onChange={() => setAccountId(account.accountId)} type="radio" value={account.accountId} />
                <span>
                  <strong>{account.displayName ?? account.accountId}</strong>
                  <small>{account.profile ? `${account.profile} · ` : ""}{account.active ? "ativa" : "desconectada"} · {account.accountId}</small>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {showOnboarding ? (
          <section className="zernio-onboarding" aria-labelledby="zernio-onboarding-title">
            <div className="zernio-onboarding__icon" aria-hidden="true">✓</div>
            <div className="zernio-onboarding__content">
              <p className="eyebrow">Próximo passo</p>
              <h3 id="zernio-onboarding-title">Conecte seu número de WhatsApp</h3>
              <p>Ainda não há números conectados a esta API key. A Zernio vai abrir a conexão oficial com a Meta e, ao terminar, você volta para esta página.</p>
              <ol>
                <li>Entre na conta Meta da empresa.</li>
                <li>Escolha ou crie uma conta do WhatsApp e confirme o número.</li>
                <li>Conclua a autorização para retornar ao SGA.</li>
              </ol>
              <button className="button" disabled={connecting} onClick={connect} type="button">{connecting ? "Preparando conexão..." : "Conectar meu WhatsApp"}</button>
            </div>
          </section>
        ) : null}

        {!accounts.length && !showOnboarding ? (
          <label className="field">
            <span>ID da conta de WhatsApp</span>
            <input autoComplete="off" onChange={(event) => setAccountId(event.target.value)} placeholder="account_..." value={accountId} />
          </label>
        ) : null}

        {!showOnboarding ? (
          <div className="connection-actions">
            <button className="button" disabled={!apiKey || !accountId || saving} onClick={save} type="button">{saving ? "Salvando..." : configured ? "Atualizar conexão" : "Salvar conexão"}</button>
            {configured ? <button className="button button--secondary" disabled={testing} onClick={test} type="button">{testing ? "Testando..." : "Testar conexão"}</button> : null}
            {keySaved ? <button className="button button--secondary" disabled={connecting} onClick={connect} type="button">{connecting ? "Abrindo..." : "Conectar número de WhatsApp"}</button> : null}
          </div>
        ) : null}
        <p className="field-hint">
          Conectar abre a tela da Zernio, que abre a conexão oficial com a Meta. O número aparece
          na sua conta da Zernio e volta para o SGA automaticamente. Use a busca de contas abaixo
          se preferir escolher o número manualmente.
        </p>

        {testResult ? testResult.ok
          ? <p className="form-message form-message--notice" role="status">Conectado: {testResult.displayName ?? testResult.accountId}{testResult.profile ? ` · ${testResult.profile}` : ""}{testResult.active ? "" : " · conta desconectada"}</p>
          : <p className="form-message form-message--error" role="alert">Falha: {testResult.error}</p>
          : null}

        {configured ? (
          <>
            <div className="connection-actions">
              <button className="button button--secondary" disabled={syncBusy} onClick={() => sync("pull")} type="button">{syncBusy ? "Sincronizando..." : "Atualizar status (do Zernio)"}</button>
              <button className="button button--secondary" disabled={syncBusy} onClick={() => sync("push")} type="button">Enviar modelos pendentes</button>
            </div>
            {syncResult ? (
              syncResult.error
                ? <p className="form-message form-message--error" role="alert">{syncResult.error}</p>
                : syncResult.failures && syncResult.failures.length
                  ? <p className="form-message form-message--error" role="alert">{syncResult.failures.join(" · ")}</p>
                  : <p className="form-message form-message--notice" role="status">Concluído: {syncResult.synchronized ?? syncResult.submitted ?? 0} modelo(s).</p>
            ) : null}
            <p className="field-hint">
              O WhatsApp da Meta só aceita texto livre dentro da janela de 24 horas de uma conversa aberta. Por isso o SGA envia
              os avisos sempre por um modelo aprovado: a aprovação é feita pela Meta e costuma levar até 24 horas.
            </p>
          </>
        ) : null}

        {keySaved && webhookState ? (
          <>
            <hr />
            <header className="panel-header">
              <div>
                <h3>Eventos do WhatsApp</h3>
                <p>Com o webhook registrado, a aprovação de modelos e as respostas dos locatários chegam sozinhas, sem precisar sincronizar na mão.</p>
              </div>
              <span className={`status status--${webhookState.registered ? "success" : "neutral"}`}><span aria-hidden="true" />{webhookState.registered ? "Ouvindo" : "Inativo"}</span>
            </header>
            {webhookState.url ? <div className="connection-actions"><code className="webhook-url">{webhookState.url}</code></div> : null}
            {webhookState.registered ? (
              <p className="field-hint">Assinado digitalmente pela Zernio e deduplicado pelo SGA: um evento repetido em nova tentativa é descartado sem efeito duplicado.</p>
            ) : null}
            <div className="connection-actions">
              <button className="button button--secondary" disabled={webhookBusy} onClick={() => manageWebhook("register")} type="button">
                {webhookBusy ? "Atualizando..." : webhookState.registered ? "Re-registrar webhook" : "Registrar webhook"}
              </button>
              {webhookState.registered ? <button className="button button--secondary" disabled={webhookBusy} onClick={() => manageWebhook("unregister")} type="button">Desregistrar</button> : null}
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
