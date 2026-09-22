import { NextResponse } from "next/server";
import { dispatchPendingMessages } from "@/lib/messaging/dispatch";
import { logger } from "@/lib/observability/logger";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expectedToken = process.env.MESSAGING_DISPATCH_TOKEN;
  if (!expectedToken) return NextResponse.json({ error: "Dispatcher não configurado." }, { status: 503 });
  const providedToken = request.headers.get("x-dispatch-token") ?? new URL(request.url).searchParams.get("token");
  if (providedToken !== expectedToken) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const limit = rateLimit(`dispatch:${clientIp(request)}`, 60, 60_000);
  if (!limit.ok) {
    logger.warn("messaging.dispatch_rate_limited", { ip: clientIp(request) });
    return NextResponse.json({ error: "Muitas chamadas." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const result = await dispatchPendingMessages();
  logger.info("messaging.dispatch", { ...result });
  return NextResponse.json(result);
}
