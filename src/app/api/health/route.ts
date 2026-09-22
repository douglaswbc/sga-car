import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { errorFields, logger } from "@/lib/observability/logger";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    await query("select 1");
  } catch (error) {
    database = "error";
    logger.error("health.database_failed", errorFields(error));
  }
  const body = { status: database === "ok" ? "ok" : "degraded", database, latencyMs: Date.now() - startedAt, time: new Date().toISOString() };
  return NextResponse.json(body, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
