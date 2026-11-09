import { db } from "../db";

/**
 * Operational monitoring over real platform state: cron heartbeats
 * (`SystemSetting cron:*`), payment-gateway webhook intake (`WebhookEvent`)
 * and database reachability. Thresholds live in SystemSetting `alert.*` rows
 * (see `npm run monitoring:setup`) with safe defaults when absent.
 */

import { ALERT_DEFAULTS, CRON_JOBS } from "../monitoring-config";

export { ALERT_DEFAULTS, CRON_JOBS };

type AlertKey = keyof typeof ALERT_DEFAULTS;

export type Alert = {
  metric: string;
  severity: "warning" | "critical";
  message: string;
};

async function thresholds(): Promise<Record<AlertKey, number>> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(ALERT_DEFAULTS) } } });
  const out = { ...ALERT_DEFAULTS } as Record<AlertKey, number>;
  for (const r of rows) {
    const n = typeof r.value === "number" ? r.value : Number((r.value as { value?: unknown } | null)?.value);
    if (Number.isFinite(n) && n > 0) out[r.key as AlertKey] = n;
  }
  return out;
}

export async function cronStatus(staleHours?: number) {
  const hours = staleHours ?? (await thresholds())["alert.cronStaleHours"];
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: "cron:" } } });
  const seen = new Map(rows.map((r) => [r.key.slice(5), r.value as { at?: string } | null]));
  const now = Date.now();
  const jobs = Object.entries(CRON_JOBS).map(([name, everySec]) => {
    const at = seen.get(name)?.at ?? null;
    const ageMinutes = at ? Math.round((now - new Date(at).getTime()) / 60_000) : null;
    // A job is stale past the configured threshold, or 3 missed cycles for
    // slow jobs whose cadence exceeds that threshold.
    const staleAfterMinutes = Math.max(hours * 60, Math.ceil((everySec * 3) / 60));
    const state = ageMinutes === null ? "never" : ageMinutes > staleAfterMinutes ? "stale" : "ok";
    return { name, lastRunAt: at, ageMinutes, expectedEverySeconds: everySec, staleAfterMinutes, state };
  });
  return {
    healthy: jobs.every((j) => j.state === "ok"),
    jobs,
  };
}

export async function webhookStatus() {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [byStatus, last, recentFailures] = await Promise.all([
    db.webhookEvent.groupBy({ by: ["status"], where: { receivedAt: { gte: since } }, _count: { _all: true } }),
    db.webhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true, providerCode: true } }),
    db.webhookEvent.findMany({
      where: { status: "FAILED" },
      orderBy: { receivedAt: "desc" },
      take: 10,
      select: { id: true, providerCode: true, type: true, externalId: true, error: true, receivedAt: true },
    }),
  ]);
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
  return {
    last24h: {
      received: Object.values(counts).reduce((a, b) => a + b, 0),
      processed: counts.PROCESSED ?? 0,
      failed: counts.FAILED ?? 0,
      ignored: (counts.IGNORED_DUPLICATE ?? 0) + (counts.IGNORED_UNKNOWN ?? 0),
      pending: counts.RECEIVED ?? 0,
    },
    lastReceivedAt: last?.receivedAt ?? null,
    lastProvider: last?.providerCode ?? null,
    recentFailures,
  };
}

async function databaseOk(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  const t = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, latencyMs: null, error: e instanceof Error ? e.message : "unknown" };
  }
}

async function evaluate() {
  const t = await thresholds();
  const [db_, crons, hooks, activeGateways] = await Promise.all([
    databaseOk(),
    cronStatus(t["alert.cronStaleHours"]),
    webhookStatus(),
    db.gatewayConfig.count({ where: { active: true, providerCode: { not: "mock" } } }),
  ]);
  const alerts: Alert[] = [];
  if (!db_.ok) alerts.push({ metric: "database", severity: "critical", message: `Database unreachable: ${db_.error}` });
  for (const j of crons.jobs) {
    if (j.state === "never") {
      alerts.push({ metric: `cron:${j.name}`, severity: "critical", message: `Cron job "${j.name}" has never run — is the scheduler running?` });
    } else if (j.state === "stale") {
      alerts.push({ metric: `cron:${j.name}`, severity: "critical", message: `Cron job "${j.name}" last ran ${j.ageMinutes} min ago (threshold ${j.staleAfterMinutes} min)` });
    }
  }
  if (hooks.last24h.failed >= t["alert.webhookFailed24h"]) {
    alerts.push({ metric: "webhooks.failed", severity: "critical", message: `${hooks.last24h.failed} payment webhooks failed in the last 24h` });
  } else if (hooks.last24h.failed > 0) {
    alerts.push({ metric: "webhooks.failed", severity: "warning", message: `${hooks.last24h.failed} payment webhook(s) failed in the last 24h` });
  }
  // Silence only matters when a real (non-sandbox) gateway is live.
  if (activeGateways > 0) {
    const staleMs = t["alert.webhookStaleHours"] * 3600_000;
    if (!hooks.lastReceivedAt || Date.now() - hooks.lastReceivedAt.getTime() > staleMs) {
      alerts.push({
        metric: "webhooks.stale",
        severity: "warning",
        message: `No payment webhook received in ${t["alert.webhookStaleHours"]}h with ${activeGateways} live gateway(s) active`,
      });
    }
  }
  return { database: db_, crons, webhooks: hooks, alerts, thresholds: t };
}

export async function checkAlerts() {
  const { alerts, thresholds: t } = await evaluate();
  return { checkedAt: new Date().toISOString(), alertCount: alerts.length, alerts, thresholds: t };
}

export async function healthReport() {
  const { database, crons, webhooks, alerts } = await evaluate();
  const status = !database.ok || alerts.some((a) => a.severity === "critical") ? "degraded" : "ok";
  return { status, database, crons, webhooks, alerts };
}
