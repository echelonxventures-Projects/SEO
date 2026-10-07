import { execSync } from "child_process";

console.log("Setting up monitoring and alerting...");

// Create initial alert thresholds
const settings = [
  { key: "alert.webhookFailed24h", value: 10, type: "number" },
  { key: "alert.webhookStaleHours", value: 24, type: "number" },
  { key: "alert.cronStaleHours", value: 2, type: "number" },
];

console.log("\n✅ Default thresholds:");
settings.forEach((s) => {
  console.log(`   ${s.key} = ${s.value}`);
});

console.log("\n📋 Cron schedule recommendations:");
console.log("   * */5 * * * *  node scripts/monitoring/check-alerts.js      # Check every 5 mins");
console.log("   POST /api/v1/cron/renew         (every 5 min - subscription renewal)");
console.log("   POST /api/v1/cron/publisher     (every 10 min - content publishing)");
console.log("   POST /api/v1/cron/email-dispatch (every 10 min - email batches)");

console.log("\n🔗 API endpoints for dashboard:");
console.log("   GET /api/v1/monitoring/health       - Full health report");
console.log("   GET /api/v1/monitoring/webhook-status - Webhook health");
console.log("   GET /api/v1/monitoring/cron-status  - Cron health");
console.log("   GET /api/v1/monitoring/alerts/check - Trigger checks");

console.log("\n✅ Setup complete");
