/**
 * Page render smoke — logs in and GETs every UI route, asserting a 200 and
 * that Next's error overlay / RSC crash markers are absent.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.DEMO_EMAIL ?? "founder@aithink.india";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPassword#1";

const PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/dashboard",
  "/clients",
  "/leads",
  "/projects",
  "/tasks",
  "/timesheets",
  "/expenses",
  "/quotes",
  "/invoices",
  "/payments",
  "/services",
  "/seo/keywords",
  "/seo/backlinks",
  "/seo/audits",
  "/campaigns",
  "/reports",
  "/team",
  "/settings",
  "/billing",
  "/billing/plans",
  "/activity",
  "/studio",
  "/content",
  "/social",
  "/links",
  "/sites",
  "/email",
  "/blogs",
  "/channels",
  "/audiences",
  "/calendar",
  "/campaigns/new",
  "/offers",
  "/events",
  "/system",
  "/temporal",
  "/temporal/patterns",
  "/temporal/calendars",
  "/temporal/appointments",
  "/temporal/resources",
  "/temporal/workforce",
  "/temporal/triggers",
  "/temporal/library",
  "/temporal/analytics",
  "/temporal/governance",
];

let cookie = "";

async function main() {
  // login
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (r.status !== 200) {
    console.error("login failed", r.status);
    process.exit(1);
  }
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const [n, v] = pair.split("=");
    if (["omnimark_session", "omnimark_org"].includes(n)) cookie += (cookie ? "; " : "") + `${n}=${v}`;
  }

  let fail = 0;
  for (const path of PAGES) {
    let status = 0;
    let bodyText = "";
    try {
      const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
      status = res.status;
      bodyText = await res.text();
    } catch (e) {
      console.error(`  ✗ ${path} — fetch threw ${e}`);
      fail++;
      continue;
    }
    const redirectOk = status === 307 || status === 308; // some pages redirect (auth gates)
    const crashed = bodyText.includes("Internal Server Error") || bodyText.includes("__next_error__") || bodyText.includes("Unhandled Runtime Error");
    const ok = (status === 200 && !crashed) || (redirectOk && !path.startsWith("/login"));
    if (ok) {
      console.log(`  ✓ ${path} (${status})`);
    } else {
      console.error(`  ✗ ${path} — status ${status}${crashed ? " (CRASHED)" : ""}`);
      const m = bodyText.match(/(error[^<]{0,120})/i);
      if (crashed && m) console.error(`      ${m[1]}`);
      fail++;
    }
  }
  // A detail page too
  const aud = await fetch(`${BASE}/api/v1/audiences?pageSize=1`, { headers: { cookie } }).then((x) => x.json());
  const audienceId = aud?.data?.[0]?.id ?? aud?.data?.rows?.[0]?.id;
  if (audienceId) {
    const res = await fetch(BASE + "/audiences/" + audienceId, { headers: { cookie } });
    const ok = res.status === 200;
    console.log(`  ${ok ? "✓" : "✗"} /audiences/[id] (${res.status})`);
    if (!ok) fail++;
  }
  const inv = await fetch(`${BASE}/api/v1/invoices?pageSize=1`, { headers: { cookie } }).then((x) => x.json());
  const invoiceId = inv?.data?.rows?.[0]?.id;
  if (invoiceId) {
    for (const p of [`/invoices/${invoiceId}`, `/print/invoices/${invoiceId}`]) {
      const res = await fetch(BASE + p, { headers: { cookie } });
      const txt = await res.text();
      const bad = res.status !== 200 || txt.includes("Internal Server Error");
      console.log(`  ${bad ? "✗" : "✓"} ${p} (${res.status})`);
      if (bad) fail++;
    }
  }
  console.log(`\n${PAGES.length + 2 - fail} rendered, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
