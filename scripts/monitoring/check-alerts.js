/**
 * Alerting check script - run via cron or manually
 * Outputs alerts to stdout or sends to external webhook
 *
 * Usage:
 *   node scripts/monitoring/check-alerts.js
 *   node scripts/monitoring/check-alerts.js --webhook=https://hooks.slack.com/...
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

async function checkAlerts() {
  try {
    const response = await fetch(`${process.env.APP_URL || "http://localhost:3000"}/api/v1/monitoring/alerts/check`, {
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    
    if (data.alertCount === 0) {
      console.log("✅ All systems healthy - no alerts");
      return;
    }

    console.log(`⚠️  Found ${data.alertCount} alert(s):`);
    
    data.alerts.forEach((alert) => {
      const icon = alert.severity === "critical" ? "🚨" : "⚠️";
      console.log(`  ${icon} [${alert.metric}] ${alert.message}`);
    });

    // Send to external webhook if configured
    if (process.argv[2]?.startsWith("--webhook=")) {
      const webhookUrl = process.argv[2].split("=")[1];
      
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

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackMessage),
      });

      console.log(`📤 Alert sent to webhook`);
    }

    // Exit with error code if there are critical alerts
    const hasCritical = data.alerts.some((a) => a.severity === "critical");
    if (hasCritical) {
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ Failed to check alerts:", error.message);
    process.exit(1);
  }
}

checkAlerts();
