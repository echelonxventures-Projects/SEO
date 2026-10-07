import { execSync } from "child_process";

// Generate test migrations for rollback verification
const TEST_MIGRATIONS = [
  {
    name: "test_add_index_on_client_email",
    up: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_email ON client(email);`,
    down: `DROP INDEX IF EXISTS idx_client_email;`,
  },
  {
    name: "test_add_column_invoice_notes",
    up: `ALTER TABLE invoice ADD COLUMN IF NOT EXISTS notes TEXT;`,
    down: `ALTER TABLE invoice DROP COLUMN IF EXISTS notes;`,
  },
];

function run(cmd: string) {
  execSync(cmd, { stdio: "inherit" });
}

console.log("Generating rollback test migrations...");

TEST_MIGRATIONS.forEach((m) => {
  run(`npx prisma migrate dev --create-only --name ${m.name}`);
  console.log(`✅ Created migration: ${m.name}`);
});

console.log("\nTo test rollback:");
console.log("  npx prisma migrate revert");
console.log("To re-apply:");
console.log("  npx prisma migrate deploy");
