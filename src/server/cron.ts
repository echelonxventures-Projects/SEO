import { getEnv } from "./env";
import { AppError, ErrorCodes } from "./errors";
import { safeEqual } from "./crypto";

/**
 * Gate for internal scheduled jobs (POST /api/v1/cron/*). Expects
 * `Authorization: Bearer <CRON_SECRET>` and compares in constant time.
 * Fails closed when CRON_SECRET is unset.
 */
export function assertCronSecret(req: Request): void {
  const secret = getEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!secret || !provided || !safeEqual(provided, secret)) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret");
  }
}

/** Records a cron heartbeat (`SystemSetting cron:<name>`) for readiness/monitoring. */
export async function stampCron(name: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { db } = await import("./db");
  const value = { ...extra, at: new Date().toISOString() } as object;
  await db.systemSetting.upsert({
    where: { key: `cron:${name}` },
    create: { key: `cron:${name}`, value },
    update: { value },
  });
}
