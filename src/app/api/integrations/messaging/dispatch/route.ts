import { NextResponse } from "next/server";
import { authenticateApiToken } from "@/lib/integrations/api-token";
import { dispatchPendingMessages } from "@/lib/messaging/dispatch";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request, "messaging:send");
  if ("response" in auth) return auth.response;

  const result = await dispatchPendingMessages(25, auth.context.organizationId);
  logger.info("integration.messaging_dispatch", { organizationId: auth.context.organizationId, tokenId: auth.context.tokenId, ...result });
  return NextResponse.json(result);
}
