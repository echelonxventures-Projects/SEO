#!/usr/bin/env node
/**
 * Schema drift gate: the database produced by `prisma migrate deploy` must
 * match prisma/schema.prisma exactly. Fails when either side has changes the
 * other doesn't — e.g. a migration whose models were lost from the schema
 * (this happened once: 47 models existed only in migrations + a stale client).
 *
 * Run against a database that has had `prisma migrate deploy` applied:
 *   DATABASE_URL=... node scripts/check-schema-drift.mjs
 *
 * ALLOWED lists statements Prisma always reports because they can't be
 * expressed in the Prisma schema language (hand-written SQL in migrations).
 */
import { execFileSync } from "node:child_process";

const ALLOWED = [
  // Partial unique index from 20260913162931_keyword_null_location_unique
  // (`WHERE "locationId" IS NULL`) — not representable in schema.prisma.
  /^DROP INDEX "Keyword_orgId_normalized_device_null_loc_key";$/,
];

let script;
try {
  script = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
} catch (err) {
  console.error("❌ prisma migrate diff failed to run");
  process.exit(1);
}

const statements = script
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("--"));
const unexpected = statements.filter((s) => !ALLOWED.some((re) => re.test(s)));

if (unexpected.length > 0) {
  console.error("❌ Schema drift: prisma/schema.prisma does not match the migrated database.");
  console.error("   Applying the schema would run:\n");
  for (const s of unexpected.slice(0, 50)) console.error(`   ${s}`);
  if (unexpected.length > 50) console.error(`   … and ${unexpected.length - 50} more`);
  console.error("\n   Fix: create a migration for schema changes (npm run db:migrate),");
  console.error("   or restore models that exist in migrations but are missing from the schema.");
  process.exit(1);
}
console.log(`✅ No schema drift (${statements.length} allowlisted statement(s) ignored)`);
