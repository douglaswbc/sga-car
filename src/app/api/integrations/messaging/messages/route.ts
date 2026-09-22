import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authenticateApiToken } from "@/lib/integrations/api-token";

export const runtime = "nodejs";

type MessageRow = {
  id: string;
  tenant_id: string | null;
  channel: string;
  event: string;
  recipient: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request, "messaging:read");
  if ("response" in auth) return auth.response;

  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 100;
  const rows = await query<MessageRow>(
    `select id, tenant_id, channel, event, recipient, status, attempts, last_error, created_at, sent_at
     from public.messages where organization_id = $1 order by created_at desc limit $2`,
    [auth.context.organizationId, limit],
  );
  return NextResponse.json({ messages: rows });
}
