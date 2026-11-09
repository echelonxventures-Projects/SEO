/**
 * Alerting check — run via cron or manually.
 * Calls GET /api/v1/monitoring/alerts/check and prints alerts; optionally
 * forwards them to a Slack-compatible incoming webhook.
 *
 * Usage:
 *   node scripts/monitoring/check-alerts.js
 *   node scripts/monitoring/check-alerts.js --webhook=https://hooks.slack.com/...
 *
 * Exit code 1 when any critical alert is present (or the check itself fails),
 * so it can gate a cron/uptime monitor.
 */

const BASE = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

function webhookArg() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--webhook="));
  return arg ? arg.slice("--webhook=".length) : null; // URLs may contain "="
}

async function checkAlerts() {
  if (!process.env.CRON_SECRET) {
    console.error("❌ CRON_SECRET is not set");
    process.exit(1);
  }
  try {
    const response = await fetch(`${BASE}/api/v1/monitoring/alerts/check`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(body?.error ?? body)}`);
    }
    const data = body.data;

    if (data.alertCount === 0) {
      console.log("✅ All systems healthy — no alerts");
      return;
    }

    console.log(`⚠️  Found ${data.alertCount} alert(s):`);
    for (const alert of data.alerts) {
      const icon = alert.severity === "critical" ? "🚨" : "⚠️";
      console.log(`  ${icon} [${alert.metric}] ${alert.message}`);
    }

    const webhookUrl = webhookArg();
    if (webhookUrl) {
      const slackMessage = {
        text: `🚨 OmniMark Alerts (${data.alertCount} found)`,
        attachments: data.alerts.map((alert) => ({
          color: alert.severity === "critical" ? "danger" : "warning",
          fields: [
            { title: "Metric", value: alert.metric, short: true },
            { title: "Severity", value: alert.severity.toUpperCase(), short: true },
            { title: "Message", value: alert.message, short: false },
          ],
        })),
      };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackMessage),
      });
      console.log(res.ok ? "📤 Alert sent to webhook" : `❌ Webhook responded ${res.status}`);
    }

    if (data.alerts.some((a) => a.severity === "critical")) process.exit(1);
  } catch (error) {
    console.error("❌ Failed to check alerts:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

checkAlerts();
