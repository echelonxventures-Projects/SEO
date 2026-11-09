/** Shared monitoring constants (dependency-free: safe for scripts). */

/** Expected cadence (seconds) per scheduled job — mirrors scripts/cron-runner.mjs. */
export const CRON_JOBS: Record<string, number> = {
  "publisher": 60,
  "email-dispatch": 60,
  "temporal-triggers": 60,
  "events": 60,
  "temporal-stream": 60,
  "flights": 300,
  "offers": 300,
  "reports": 300,
  "renew": 900,
  "calendar-sync": 900,
  "temporal-materialize": 3600,
  "temporal-governance": 21600,
};

export const ALERT_DEFAULTS = {
  "alert.webhookFailed24h": 10,
  "alert.webhookStaleHours": 24,
  "alert.cronStaleHours": 2,
} as const;
