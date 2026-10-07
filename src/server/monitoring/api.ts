import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import type { Ctx } from "../services/common";
import { getWebhookHealth, getCronHealth, getHealthReport, ALERT_THRESHOLDS } from "./health";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const alertThresholdSchema = z.object({
  webhookFailed24h: z.number().int().min(1).max(1000),
  webhookStaleHours: z.number().int().min(1).max(720), // 30 days max
  cronStaleHours: z.number().int().min(1).max(168),   // 7 days max
});

export type AlertThresholds = z.infer<typeof alertThresholdSchema>;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/monitoring/health
 * Comprehensive health check for dashboards
 */
export async function getHealth(ctx: Ctx) {
  return await getHealthReport();
}

/**
 * GET /api/v1/monitoring/webhook-status
 * Quick webhook health check
 */
export async function getWebhookStatus(ctx: Ctx) {
  return await getWebhookHealth();
}

/**
 * GET /api/v1/monitoring/cron-status
 * Quick cron health check
 */
export async function getCronStatus(ctx: Ctx) {
  return await getCronHealth();
}

/**
 * GET /api/v1/monitoring/alerts/thresholds
 * Get current alert thresholds
 */
export async function getAlertThresholds(ctx: Ctx) {
  const [
    webhookFailed,
    webhookStale,
    cronStale,
  ] = await Promise.all([
    db.systemSetting.findUnique({ where: { key: "alert.webhookFailed24h" } }),
    db.systemSetting.findUnique({ where: { key: "alert.webhookStaleHours" } }),
    db.systemSetting.findUnique({ where: { key: "alert.cronStaleHours" } }),
  ]);

  return {
    webhookFailed24h: webhookFailed ? (webhookFailed.value as number) : ALERT_THRESHOLDS.webhookFailed24h,
    webhookStaleHours: webhookStale ? (webhookStale.value as number) : ALERT_THRESHOLDS.webhookStaleHours,
    cronStaleHours: cronStale ? (cronStale.value as number) : ALERT_THRESHOLDS.cronStaleHours,
  };
}

/**
 * PUT /api/v1/monitoring/alerts/thresholds
 * Update alert thresholds (requires OWNER/ADMIN)
 */
export async function updateAlertThresholds(ctx: Ctx, input: unknown) {
  const data = alertThresholdSchema.parse(input);

  if (ctx.viewer.active.roleCode !== "OWNER" && ctx.viewer.active.roleCode !== "ADMIN") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Only owners/admins can update alert thresholds");
  }

  await db.$transaction([
    db.systemSetting.upsert({
      where: { key: "alert.webhookFailed24h" },
      create: { key: "alert.webhookFailed24h", value: data.webhookFailed24h as unknown as Prisma.InputJsonValue, valueType: "number" },
      update: { value: data.webhookFailed24h as unknown as Prisma.InputJsonValue },
    }),
    db.systemSetting.upsert({
      where: { key: "alert.webhookStaleHours" },
      create: { key: "alert.webhookStaleHours", value: data.webhookStaleHours as unknown as Prisma.InputJsonValue, valueType: "number" },
      update: { value: data.webhookStaleHours as unknown as Prisma.InputJsonValue },
    }),
    db.systemSetting.upsert({
      where: { key: "alert.cronStaleHours" },
      create: { key: "alert.cronStaleHours", value: data.cronStaleHours as unknown as Prisma.InputJsonValue, valueType: "number" },
      update: { value: data.cronStaleHours as unknown as Prisma.InputJsonValue },
    }),
  ]);

  return getAlertThresholds(ctx);
}

/**
 * GET /api/v1/monitoring/alerts/check
 * Run checks and return any triggered alerts
 */
export async function checkAlerts(ctx: Ctx) {
  const thresholds = await getAlertThresholds(ctx);
  const webhookHealth = await getWebhookHealth();
  const cronHealth = await getCronHealth();

  const alerts: Array<{
    severity: "warning" | "critical";
    metric: string;
    message: string;
  }> = [];

  // Check webhook thresholds
  if (webhookHealth.failedCount24h >= thresholds.webhookFailed24h) {
    alerts.push({
      severity: webhookHealth.failedCount24h >= thresholds.webhookFailed24h * 2 ? "critical" : "warning",
      metric: "webhook.failures_24h",
      message: `${webhookHealth.failedCount24h} webhook failures in 24h (threshold: ${thresholds.webhookFailed24h})`,
    });
  }

  if (webhookHealth.isStale) {
    alerts.push({
      severity: "critical",
      metric: "webhook.stale",
      message: `No webhooks received in ${webhookHealth.lastWebhookReceived ? Math.round((new Date() - webhookHealth.lastWebhookReceived) / (1000 * 60 * 60)) : ">"} ${thresholds.webhookStaleHours} hours`,
    });
  }

  // Check cron thresholds
  for (const [job, { status, staleHours }] of Object.entries(cronHealth)) {
    if (status === "stale" && staleHours >= thresholds.cronStaleHours) {
      alerts.push({
        severity: "warning",
        metric: `cron.${job}.stale`,
        message: `${job} is ${Math.round(staleHours)} hours stale (threshold: ${thresholds.cronStaleHours})`,
      });
    }

    if (status === "critical") {
      alerts.push({
        severity: "critical",
        metric: `cron.${job}.down`,
        message: `${job} appears to be not running (last seen ${Math.round(staleHours)}h ago)`,
      });
    }
  }

  return {
    timestamp: new Date(),
    threshold: thresholds,
    alerts,
    alertCount: alerts.length,
  };
}
