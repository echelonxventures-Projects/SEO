/**
 * Migration replay verification.
 *
 * Prisma Migrate has no down-migrations, so "rollback" here means what it
 * can honestly mean: the full migration history must replay cleanly onto an
 * empty database, report up-to-date, and the seed must be idempotent (running
 * it twice leaves the same row counts). Recovery from a bad deploy is done by
 * shipping a new forward migration, verified by this same replay.
 *
 * DESTRUCTIVE: resets the database at DATABASE_URL. Refuses to run unless the
 * database name ends in _test / _ci, or MIGRATION_TEST_ALLOW_RESET=1.
 *
 * Usage: npm run test:migration-rollback
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, "");
if (!/_(test|ci)$/.test(dbName) && process.env.MIGRATION_TEST_ALLOW_RESET !== "1") {
  console.error(
    `Refusing to reset database "${dbName}". Use a *_test / *_ci database or set MIGRATION_TEST_ALLOW_RESET=1.`,
  );
  process.exit(1);
}

const log = (msg: string) => console.log(`[MIGRATIONS] ${msg}`);
const run = (cmd: string) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

const COUNTED = ["plan", "role", "permission", "user", "organization", "taxRate", "currency"] as const;

async function counts(db: PrismaClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of COUNTED) {
    const delegate = (db as unknown as Record<string, { count?: () => Promise<number> }>)[model];
    if (delegate?.count) out[model] = await delegate.count();
  }
  return out;
}

async function main() {
  log("1/4 reset + replay every migration onto an empty database");
  run("npx prisma migrate reset --force");

  log("2/4 migration status must be up to date");
  run("npx prisma migrate status");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  try {
    log("3/4 seed (first run)");
    run("npm run db:seed");
    const first = await counts(db);

    log("4/4 seed again — must be idempotent");
    run("npm run db:seed");
    const second = await counts(db);

    const diffs = Object.keys(first).filter((k) => first[k] !== second[k]);
    if (diffs.length > 0) {
      for (const k of diffs) log(`❌ ${k}: ${first[k]} -> ${second[k]}`);
      throw new Error("seed is not idempotent");
    }
    log(`row counts stable: ${JSON.stringify(second)}`);
  } finally {
    await db.$disconnect();
  }
  log("✅ migrations replay cleanly and seed is idempotent");
}

main().catch((e) => {
  console.error("❌ Migration verification failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
