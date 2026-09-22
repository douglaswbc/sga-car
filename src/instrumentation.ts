export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.MESSAGING_SCHEDULER_ENABLED !== "true") return;

  const configured = Number(process.env.MESSAGING_SCHEDULER_INTERVAL_MS ?? "900000");
  const intervalMs = Number.isFinite(configured) && configured >= 30000 ? configured : 900000;

  const { logger } = await import("@/lib/observability/logger");
  const { dispatchPendingMessages } = await import("@/lib/messaging/dispatch");

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await dispatchPendingMessages();
      if (result.processed || result.reminders) logger.info("scheduler.dispatch", { ...result });
    } catch (error) {
      logger.error("scheduler.dispatch_failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  logger.info("scheduler.enabled", { intervalMs });
}
