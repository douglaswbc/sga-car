"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/form-message";
import { useToast } from "@/components/toast";
import { createApiToken, revokeApiToken } from "@/features/organizations/api-token-actions";
import { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from "@/lib/integrations/scopes";
import type { OrganizationApiToken } from "@/lib/supabase/types";

const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "—");

export function ApiTokenManager({ organizationId, tokens }: Readonly<{ organizationId: string; tokens: OrganizationApiToken[] }>) {
  const router = useRouter(); const { show } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["messaging:send", "messaging:read"]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [createdToken, setCreatedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const toggleScope = (scope: ApiScope) => setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      show("Token copiado para a área de transferência.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      show("Não foi possível copiar automaticamente. Selecione o token e copie manualmente.", "error");
    }
  };

  const create = async () => {
    setSaving(true); setError(""); setCreatedToken("");
    const result = await createApiToken({ organizationId, name, scopes, expiresInDays });
    setSaving(false);
    if (result.error || !result.token) { setError(result.error ?? "Não foi possível criar o token."); return; }
    setCreatedToken(result.token);
    setName("");
    show("Token criado. Copie-o agora.");
    router.refresh();
  };

  const revoke = async (tokenId: string) => {
    if (!window.confirm("Revogar este token? Integrações que o usam deixarão de funcionar.")) return;
    setRevoking(tokenId); setError("");
    const result = await revokeApiToken({ organizationId, tokenId });
    setRevoking(null);
    if (result.error) { setError(result.error); return; }
    show("Token revogado.");
    router.refresh();
  };

  return <>
    <article className="panel"><header className="panel-header"><div><h2>Novo token de API</h2><p>Use em integrações externas como o n8n. O token é exibido apenas uma vez.</p></div></header>
      <div className="connection-body">
        <FormMessage tone="error">{error}</FormMessage>
        <label>Nome<input maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Ex.: n8n cobrança" value={name} /></label>
        <fieldset className="billing-fields"><legend>Escopos</legend>{API_SCOPES.map((scope) => <label className="checkbox-field" key={scope}><input checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} type="checkbox" />{API_SCOPE_LABELS[scope]}</label>)}</fieldset>
        <label>Validade<select onChange={(event) => setExpiresInDays(Number(event.target.value))} value={expiresInDays}><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>1 ano</option><option value={0}>Sem expiração</option></select></label>
        <button className="button" disabled={saving || !name || !scopes.length} onClick={create} type="button">{saving ? "Criando..." : "Criar token"}</button>
        {createdToken ? <div className="token-reveal" role="status"><strong>Copie o token agora — ele não será exibido novamente.</strong><div className="token-reveal-row"><code>{createdToken}</code><button className="button button--secondary" onClick={copyToken} type="button">{copied ? "Copiado!" : "Copiar"}</button></div></div> : null}
      </div>
    </article>
    <article className="panel admin-panel"><header className="panel-header"><div><h2>Tokens existentes</h2><p>{tokens.length} token(s). Tokens revogados não podem ser reutilizados.</p></div></header>{tokens.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Nome</th><th scope="col">Prefixo</th><th scope="col">Escopos</th><th scope="col">Último uso</th><th scope="col">Validade</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Ação</span></th></tr></thead><tbody>{tokens.map((token) => <tr key={token.id}><td><strong>{token.name}</strong></td><td><code>{token.token_prefix}…</code></td><td>{token.scopes.join(", ")}</td><td>{dateTime(token.last_used_at)}</td><td>{token.expires_at ? dateTime(token.expires_at) : "Sem expiração"}</td><td>{token.revoked_at ? <span className="status status--danger"><span aria-hidden="true" />Revogado</span> : <span className="status status--success"><span aria-hidden="true" />Ativo</span>}</td><td>{token.revoked_at ? "—" : <button className="table-action table-action--danger" disabled={revoking === token.id} onClick={() => revoke(token.id)} type="button">{revoking === token.id ? "Revogando..." : "Revogar"}</button>}</td></tr>)}</tbody></table></div> : <p className="empty-state">Nenhum token criado ainda.</p>}</article>
  </>;
}
