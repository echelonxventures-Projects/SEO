import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";

// Thresholds (can be tuned per environment)
const WEBHOOK_FAILURE_THRESHOLD = 5;         // Number of consecutive failures before alert
const WEBHOOK_STALENESS_HOURS = 24;          // Hours since last successful webhook
const CRON_STALENESS_HOURS = {
  renew: 2,           // Should run frequently
  publisher: 1,       // Content publishing
  "email-dispatch": 2, // Email sending
  flights: 1,         // Campaign status
  events: 2,          // Event scheduling
  temporal: {
    materialize: 6,
    triggers: 2,
    governance: 12,
    stream: 2,
  },
  reports: 12,        // Report generation
};

/**
 * Check if webhooks are receiving events
 */
export async function getWebhookHealth() {
  const lastWebhook = await db.webhookEvent.findFirst({
    orderBy: { receivedAt: "desc" },
    select: {
      receivedAt: true,
      status: true,
      providerCode: true,
    },
  });

  const failedCount = await db.webhookEvent.count({
    where: {
      status: "FAILED",
      receivedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
  });

  const failedConsecutive = await db.webhookEvent.findMany({
    where: { status: "FAILED" },
    orderBy: { receivedAt: "desc" },
    take: 10,
  });

  // Check if there's been any successful webhook in the last 24 hours
  const lastSuccessful = await db.webhookEvent.findFirst({
    where: { status: "PROCESSED" },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });

  return {
    lastWebhookReceived: lastWebhook?.receivedAt,
    lastSuccessfulProcessing: lastSuccessful?.receivedAt,
    failedCount24h: failedCount,
    isStale: !lastWebhook || 
      (new Date() - lastWebhook.receivedAt) / (1000 * 60 * 60) > WEBHOOK_STALENESS_HOURS,
    hasConsecutiveFailures: failedConsecutive.length >= WEBHOOK_FAILURE_THRESHOLD,
    lastFailure: failedConsecutive[0]?.receivedAt,
  };
}

/**
 * Check if cron jobs are running on schedule
 */
export async function getCronHealth() {
  const results: Record<string, { status: "healthy" | "stale" | "critical"; lastRun: Date | null; staleHours: number }> = {};

  // Check each cron key in SystemSetting
  const cronKeys = Object.keys(CRON_STALENESS_HOURS).filter((k) => !k.includes("."));

  for (const key of cronKeys) {
    const setting = await db.systemSetting.findUnique({
      where: { key: `cron:${key}` },
    });

    if (!setting) {
      results[key] = {
        status: "critical",
        lastRun: null,
        staleHours: 999,
      };
      continue;
    }

    const lastRun = new Date(setting.value as string);
    const staleHours = (new Date() - lastRun) / (1000 * 60 * 60);
    const threshold = CRON_STALENESS_HOURS[key as keyof typeof CRON_STALENESS_HOURS] as number;

    results[key] = {
      status: staleHours > threshold * 2 ? "critical" : staleHours > threshold ? "stale" : "healthy",
      lastRun,
      staleHours: Math.round(staleHours * 10) / 10,
    };
  }

  // Check temporal sub-jobs
  const temporalJobs = Object.entries(CRON_STALENESS_HOURS.temporal as Record<string, number>);
  for (const [subKey, threshold] of temporalJobs) {
    const setting = await db.systemSetting.findUnique({
      where: { key: `cron:temporal-${subKey}` },
    });

    if (!setting) {
      results[`temporal-${subKey}`] = {
        status: "critical",
        lastRun: null,
        staleHours: 999,
      };
      continue;
    }

    const lastRun = new Date(setting.value as string);
    const staleHours = (new Date() - lastRun) / (1000 * 60 * 60);

    results[`temporal-${subKey}`] = {
      status: staleHours > threshold * 2 ? "critical" : staleHours > threshold ? "stale" : "healthy",
      lastRun,
      staleHours: Math.round(staleHours * 10) / 10,
    };
  }

  return results;
}

/**
 * Get comprehensive health report
 */
export async function getHealthReport() {
  const webhookHealth = await getWebhookHealth();
  const cronHealth = await getCronHealth();

  const unhealthyJobs = Object.entries(cronHealth).filter(([, v]) => v.status !== "healthy");
  const staleJobs = unhealthyJobs.filter(([, v]) => v.status === "stale");
  const criticalJobs = unhealthyJobs.filter(([, v]) => v.status === "critical");

  return {
    webhook: webhookHealth,
    cron: cronHealth,
    summary: {
      healthyJobs: Object.keys(cronHealth).length - unhealthyJobs.length,
      staleJobs: staleJobs.length,
      criticalJobs: criticalJobs.length,
      overallStatus: criticalJobs.length > 0 ? "critical" : staleJobs.length > 0 ? "stale" : "healthy",
    },
    recommendations: getRecommendations(webhookHealth, cronHealth),
  };
}

function getRecommendations(
  webhookHealth: Awaited<ReturnType<typeof getWebhookHealth>>,
  cronHealth: Awaited<ReturnType<typeof getCronHealth>>
): string[] {
  const recs: string[] = [];

  if (webhookHealth.isStale) {
    recs.push("No webhooks received in 24 hours - verify provider webhooks are configured");
  }

  if (webhookHealth.hasConsecutiveFailures) {
    recs.push(`Webhook failures (${webhookHealth.failedCount24h} in 24h) - check signature verification`);
  }

  for (const [job, { status, staleHours }] of Object.entries(cronHealth)) {
    if (status === "critical") {
      recs.push(`${job} cron job is ${Math.round(staleHours)}h stale - check scheduler configuration`);
    } else if (status === "stale") {
      recs.push(`${job} cron job is approaching staleness threshold`);
    }
  }

  if (recs.length === 0) {
    recs.push("All systems healthy");
  }

  return recs;
}

/**
 * Alert threshold configuration
 */
export const ALERT_THRESHOLDS = {
  webhookFailed24h: 10,           // Alert after X failed webhooks in 24h
  webhookStaleHours: 24,          // Alert if no webhook in X hours
  cronStaleHours: 2,              // Alert if cron job is X hours stale
} as const;
