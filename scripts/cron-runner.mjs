#!/usr/bin/env node
/**
 * OmniMark scheduler — drives every internal job at /api/v1/cron/*.
 *
 * Zero dependencies. Runs as its own process (docker compose `scheduler`
 * service, or `npm run cron` locally). Each job runs on its own interval, never
 * overlaps itself, and logs one JSON line per run. Jobs are idempotent server
 * side, so a missed or doubled tick is harmless.
 *
 * Env:
 *   CRON_TARGET_URL  base URL of the app (default APP_URL, then http://localhost:3000)
 *   CRON_SECRET      bearer secret (required)
 *   CRON_ONLY        optional comma list of job names to run (e.g. "renew,publisher")
 *   CRON_ONCE=1      run every job once and exit (useful for CI / manual kicks)
 */

const BASE = (process.env.CRON_TARGET_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
const ONLY = (process.env.CRON_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const ONCE = process.env.CRON_ONCE === "1";
const TIMEOUT_MS = 5 * 60_000;

if (!SECRET) {
  console.error(JSON.stringify({ level: "fatal", msg: "CRON_SECRET is not set" }));
  process.exit(1);
}

/** name -> interval in seconds. Tuned to each job's latency needs. */
const JOBS = {
  "publisher": 60,              // content calendar publishing
  "email-dispatch": 60,         // email send batches
  "temporal-triggers": 60,      // fire due temporal triggers
  "events": 60,                 // UCOS outbox -> webhook fan-out
  "temporal-stream": 60,        // event-stream sinks
  "flights": 300,               // campaign flight LIVE/ENDED sweep
  "offers": 300,                // offer lifecycle sweep
  "reports": 300,               // due scheduled report runs
  "renew": 900,                 // subscription renewal + overdue sweep
  "calendar-sync": 900,         // external calendar pull sync
  "temporal-materialize": 3600, // extend recurring series to horizon
  "temporal-governance": 21600, // retention pruning + hold expiry
};

const running = new Set();

async function runJob(name) {
  if (running.has(name)) {
    log({ level: "warn", job: name, msg: "previous run still in flight — skipped" });
    return;
  }
  running.add(name);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/v1/cron/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    log({ level: res.ok ? "info" : "error", job: name, status: res.status, ms: Date.now() - started, body: res.ok ? body?.data ?? body : body });
  } catch (err) {
    log({ level: "error", job: name, ms: Date.now() - started, msg: err instanceof Error ? err.message : String(err) });
  } finally {
    running.delete(name);
  }
}

function log(obj) {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...obj }));
}

const selected = Object.entries(JOBS).filter(([name]) => ONLY.length === 0 || ONLY.includes(name));
if (ONLY.length) {
  const unknown = ONLY.filter((n) => !(n in JOBS));
  if (unknown.length) log({ level: "warn", msg: `unknown jobs ignored: ${unknown.join(", ")}` });
}

if (ONCE) {
  for (const [name] of selected) await runJob(name);
  process.exit(0);
}

log({ level: "info", msg: `scheduler started against ${BASE}`, jobs: Object.fromEntries(selected) });
// Stagger first runs so a cold start doesn't stampede the app.
selected.forEach(([name, every], i) => {
  setTimeout(() => {
    void runJob(name);
    setInterval(() => void runJob(name), every * 1000);
  }, 5_000 + i * 2_000);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log({ level: "info", msg: `received ${sig}, exiting` });
    process.exit(0);
  });
}
