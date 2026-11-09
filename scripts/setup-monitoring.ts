/**
 * Writes default alert thresholds into SystemSetting (`alert.*`). Existing
 * values are kept unless --force is passed, so operators' tuning survives.
 *
 *   npm run monitoring:setup            # insert missing defaults
 *   npm run monitoring:setup -- --force # reset all to defaults
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ALERT_DEFAULTS, CRON_JOBS } from "../src/server/monitoring-config";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const force = process.argv.includes("--force");

async function main() {
  console.log("Setting up monitoring thresholds…\n");
  for (const [key, value] of Object.entries(ALERT_DEFAULTS)) {
    const existing = await db.systemSetting.findUnique({ where: { key } });
    if (existing && !force) {
      console.log(`   = ${key} = ${JSON.stringify(existing.value)} (kept)`);
      continue;
    }
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value, valueType: "number" },
      update: { value, valueType: "number" },
    });
    console.log(`   ✓ ${key} = ${value}`);
  }

  console.log("\nScheduled jobs (driven by `npm run cron` / the compose `scheduler` service):");
  for (const [name, every] of Object.entries(CRON_JOBS)) {
    console.log(`   POST /api/v1/cron/${name.padEnd(22)} every ${every}s`);
  }
  console.log("\nMonitoring endpoints (Bearer $CRON_SECRET):");
  console.log("   GET /api/v1/monitoring/health");
  console.log("   GET /api/v1/monitoring/webhook-status");
  console.log("   GET /api/v1/monitoring/cron-status");
  console.log("   GET /api/v1/monitoring/alerts/check");
  console.log("\n✅ Setup complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
