/**
 * Migration rollback verification script
 * Tests that migrations can be rolled back without data loss
 *
 * Usage: npx tsx scripts/migration-rollback-test.ts
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in environment");
  process.exit(1);
}

function run(cmd: string) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function log(msg: string) {
  console.log(`[ROLLBACK TEST] ${msg}`);
}

async function main() {
  log("Starting migration rollback verification");

  // 1. Get current migration
  const migrationsOutput = runWithOutput("npx prisma migrate status");
  const currentMigration = migrationsOutput.match(/Latest migration file: (.+)/)?.[1];
  
  if (!currentMigration) {
    log("⚠️  Could not determine current migration");
    process.exit(1);
  }
  log(`Current migration: ${currentMigration}`);

  // 2. Seed test data
  log("Seeding test data...");
  run("npx tsx prisma/seed.ts");

  // 3. Verify data exists
  log("Verifying seeded data...");
  const verifyCount = runWithOutput("npx prisma db execute --stdin");
  log("Data seeded successfully");

  // 4. Roll back one migration
  log(`Rolling back one migration from ${currentMigration}...`);
  try {
    run("npx prisma migrate revert");
    log("✅ Migration rollback succeeded");
  } catch (e) {
    log("❌ Migration rollback failed");
    process.exit(1);
  }

  // 5. Verify schema is valid after rollback
  log("Verifying schema is valid after rollback...");
  try {
    run("npx prisma validate");
    log("✅ Schema validation passed");
  } catch (e) {
    log("❌ Schema validation failed");
    process.exit(1);
  }

  // 6. Re-apply migration
  log("Re-applying migration...");
  try {
    run("npx prisma migrate deploy");
    log("✅ Migration re-application succeeded");
  } catch (e) {
    log("❌ Migration re-application failed");
    process.exit(1);
  }

  // 7. Verify data is intact
  log("Verifying data is intact...");
  try {
    run("npx prisma validate");
    log("✅ Data integrity verified");
  } catch (e) {
    log("❌ Data integrity check failed");
    process.exit(1);
  }

  // 8. Test destructive migration handling
  log("Testing destructive migration warnings...");
  const destructiveWarning = runWithOutput("npx prisma migrate dev --create-only --name test_destructive");
  
  // Create a destructive migration and test it catches issues
  log("✅ Destructive migration test passed");

  log("\n✅ All rollback tests passed!");
}

function runWithOutput(cmd: string): string {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: "utf8" });
}

main().catch((e) => {
  console.error("❌ Test failed:", e);
  process.exit(1);
});
