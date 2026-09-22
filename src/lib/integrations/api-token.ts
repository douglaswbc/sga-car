import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { ApiScope } from "@/lib/integrations/scopes";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from "@/lib/integrations/scopes";

export function hashApiToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiToken() {
  const raw = `sga_${randomBytes(24).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashApiToken(raw) };
}

export type TokenContext = { tokenId: string; organizationId: string; scopes: string[] };

export async function authenticateApiToken(request: Request, requiredScope: ApiScope): Promise<{ context: TokenContext } | { response: NextResponse }> {
  const header = request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
  const raw = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  if (!raw.startsWith("sga_")) {
    return { response: NextResponse.json({ error: "Token ausente ou inválido." }, { status: 401 }) };
  }

  const hash = hashApiToken(raw);
  const limit = rateLimit(`api-token:${hash.slice(0, 16)}`, 120, 60_000);
  if (!limit.ok) {
    return { response: NextResponse.json({ error: "Muitas chamadas." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }) };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resolve_organization_api_token", { presented_token_hash: hash });
  const token = data?.[0];
  if (error || !token) {
    const message = error?.message.includes("expired") ? "Token expirado." : error?.message.includes("revoked") ? "Token revogado." : "Token inválido.";
    return { response: NextResponse.json({ error: message }, { status: 401 }) };
  }
  if (!token.scopes.includes(requiredScope)) {
    return { response: NextResponse.json({ error: "Permissão insuficiente para este recurso." }, { status: 403 }) };
  }

  return { context: { tokenId: token.token_id, organizationId: token.organization_id, scopes: token.scopes } };
}
