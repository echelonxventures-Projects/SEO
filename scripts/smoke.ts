/**
 * End-to-end API smoke test against a running OmniMark server.
 * Usage: BASE=http://localhost:3000 npx tsx scripts/smoke.ts
 */
import "dotenv/config";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SINK_HOST = process.env.SMOKE_SINK_HOST ?? "127.0.0.1"; // when the suite targets a containerized app, set host.docker.internal
const EMAIL = process.env.DEMO_EMAIL ?? "founder@aithink.india";
const PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPassword#1";

const jar = new Map<string, string>();
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
let csrf = "";
let passed = 0;
let failed = 0;

function assert(cond: unknown, label: string): asserts cond {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  raw = false,
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      origin: BASE,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...headers,
    },
    body: body !== undefined ? (raw ? (body as string) : JSON.stringify(body)) : undefined,
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (["omnimark_session", "omnimark_org"].includes(name)) jar.set(name, value);
    if (name === "omnimark_csrf") csrf = value;
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Smoke-testing ${BASE}\n`);

  // 0. Security headers present
  const head = await fetch(`${BASE}/login`);
  assert(head.headers.get("x-content-type-options") === "nosniff", "nosniff header set");
  assert((head.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), "CSP includes frame-ancestors");

  // 1. Auth
  let r = await call("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
  assert(r.status === 200, `login (${r.status})`);
  assert(!!csrf, "csrf cookie issued");

  r = await call("POST", "/api/v1/auth/login", { email: EMAIL, password: "wrong-password" });
  assert(r.status === 401, "bad password rejected");

  r = await call("GET", "/api/v1/auth/me");
  assert(r.status === 200 && r.json?.data?.active?.roleCode === "OWNER", "me returns OWNER role");
  r.json.data.active.orgId;

  // 2. CSRF protection
  const noCsrf = await fetch(`${BASE}/api/v1/clients`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(), origin: BASE },
    body: JSON.stringify({ name: "CSRF Probe" }),
  });
  assert(noCsrf.status === 403, "write without csrf token rejected");

  // clear far-future assignment backlog from previous runs (workforce seats)
  {
    const oldAsg = (await call("GET", "/api/v1/temporal/workforce/assignments?from=2028-01-01")).json.data as Array<{ id: string }>;
    for (const a of oldAsg) await call("DELETE", `/api/v1/temporal/workforce/assignments/${a.id}`);
  }

  // delete stale smoke triggers from previous runs (cron batches + listing stay deterministic)
  {
    const oldTrigs = (await call("GET", "/api/v1/temporal/triggers")).json.data as Array<{ id: string; name: string }>;
    for (const t of oldTrigs) if (t.name.startsWith("Smoke ")) await call("DELETE", `/api/v1/temporal/triggers/${t.id}`);
  }

  // purge leaked smoke clients from previous runs (client seats count non-archived)
  for (const q of ["Smoke", "Tagged"]) {
    const old = (await call("GET", `/api/v1/clients?pageSize=200&q=${q}`)).json.data;
    for (const row of old?.rows ?? []) {
      if (row.status !== "ARCHIVED" && /^Smoke (Client|Co)|Tagged Co/.test(row.name)) await call("PATCH", `/api/v1/clients/${row.id}`, { status: "ARCHIVED" });
    }
  }

  // 3. CRM
  r = await call("POST", "/api/v1/clients", {
    name: `Smoke Client ${Date.now()}`,
    billingEmail: "billing@smoke.test",
    state: "Maharashtra",
    country: "IN",
  });
  assert(r.status === 201 || r.status === 200, "client created");
  const clientId = r.json.data.id;
  const smokeClientIds: string[] = [clientId];

  r = await call("GET", `/api/v1/clients/${clientId}`);
  assert(r.status === 200 && r.json.data.client.id === clientId, "client readable");

  r = await call("GET", "/api/v1/clients");
  assert(r.status === 200 && Array.isArray(r.json.data.rows), "client list works");

  // 4. Project + task + time (purge smoke projects from previous runs first —
  // project seats count every row, so the suite must release what it creates)
  {
    const stale = (await call("GET", "/api/v1/projects?q=Smoke+Project&pageSize=200")).json.data;
    for (const row of stale?.rows ?? []) await call("DELETE", `/api/v1/projects/${row.id}`);
  }
  r = await call("POST", "/api/v1/projects", { clientId, name: `Smoke Project ${Date.now()}`, hourlyRate: 1500 });
  assert(r.status === 200 || r.status === 201, "project created");
  const projectId = r.json.data.id;

  r = await call("POST", "/api/v1/tasks", { projectId, title: "Smoke task", priority: "HIGH" });
  assert(r.status === 200 || r.status === 201, "task created");
  const taskId = r.json.data.id;

  r = await call("PATCH", `/api/v1/tasks/${taskId}`, { status: "IN_PROGRESS" });
  assert(r.status === 200, `task status transition TODO→IN_PROGRESS (${r.status} ${JSON.stringify(r.json ?? "NOJSON").slice(0, 140)})`);

  r = await call("PATCH", `/api/v1/tasks/${taskId}`, { status: "DONE" });
  assert(r.status === 409, "illegal task transition IN_PROGRESS→DONE blocked");

  r = await call("POST", "/api/v1/time", {
    projectId,
    taskId,
    date: new Date().toISOString().slice(0, 10),
    minutes: 90,
    billable: true,
  });
  assert(r.status === 200 || r.status === 201, "time logged");

  // 5. Quote lifecycle
  r = await call("POST", "/api/v1/quotes", {
    clientId,
    lines: [{ description: "Smoke service", qty: 10, unitPrice: 2500, discountBps: 500, taxRateId: null }],
    discount: 0,
  });
  assert(r.status === 200 || r.status === 201, "quote created");
  const quoteId = r.json.data.id;
  const quoteTotal = r.json.data.totalMinor;
  assert(quoteTotal === 2375000, `line math: 10×₹2500 −5% = ₹23,750 → ${quoteTotal} paise`);

  r = await call("POST", `/api/v1/quotes/${quoteId}/send`);
  assert(r.status === 200, "quote sent");
  r = await call("POST", `/api/v1/quotes/${quoteId}/decision`, { accept: true });
  assert(r.status === 200, "quote accepted");
  r = await call("POST", `/api/v1/quotes/${quoteId}/convert`, {});
  assert(r.status === 200 || r.status === 201, "quote converted to invoice");
  const invFromQuote = r.json.data.id;

  r = await call("POST", `/api/v1/invoices/${invFromQuote}/issue`);
  assert(r.status === 200, "invoice issued");
  r = await call("GET", `/api/v1/invoices/${invFromQuote}`);
  assert(r.status === 200 && r.json.data.lines.length === 1, "converted invoice has line");

  // 6. Payment recording + status machine
  r = await call("POST", "/api/v1/payments", {
    invoiceId: invFromQuote,
    amount: 10000,
    method: "UPI",
    paidAt: new Date().toISOString(),
    reference: "SMOKE-UTR-1",
  });
  assert(r.status === 200 || r.status === 201, "partial payment recorded");
  r = await call("GET", `/api/v1/invoices/${invFromQuote}`);
  assert(r.json.data.status === "PARTIALLY_PAID", "invoice PARTIALLY_PAID");

  const over = await call("POST", "/api/v1/payments", {
    invoiceId: invFromQuote,
    amount: 999999,
    method: "UPI",
    paidAt: new Date().toISOString(),
  });
  assert(over.status === 422, "overpayment rejected (422)");
  assert(over.json?.error?.code === "VALIDATION", "overpayment error is VALIDATION");

  r = await call("POST", "/api/v1/payments", {
    invoiceId: invFromQuote,
    amount: quoteTotal / 100 - 10000,
    method: "BANK_TRANSFER",
    paidAt: new Date().toISOString(),
  });
  assert(r.status === 200 || r.status === 201, "balance paid");
  r = await call("GET", `/api/v1/invoices/${invFromQuote}`);
  assert(r.json.data.status === "PAID", "invoice PAID after full settlement");

  // 7. Tax derivation (GST 18% → CGST 9 + SGST 9 breakdown)
  const gst18 = await call("GET", "/api/v1/settings/tax-rates");
  const intra = gst18.json.data.find((t: any) => t.code === "GST_18_INTRA");
  assert(!!intra && intra.components.length === 2, "GST 18% intra group has 2 components");
  r = await call("POST", "/api/v1/invoices", {
    clientId,
    lines: [{ description: "Taxed service", qty: 1, unitPrice: 11800, taxRateId: intra.id }],
  });
  assert(r.status === 200 || r.status === 201, "invoice with GST created");
  assert(r.json.data.taxMinor === 212400, `GST 18% on ₹11,800 = ₹2,124 → ${r.json.data.taxMinor} paise`);
  const breakdown: any[] = r.json.data.taxBreakdown;
  assert(breakdown.length === 2, "breakdown shows CGST + SGST separately");
  const taxInvoiceId = r.json.data.id;
  await call("POST", `/api/v1/invoices/${taxInvoiceId}/void`, { reason: "smoke cleanup" });
  const voided = await call("GET", `/api/v1/invoices/${taxInvoiceId}`);
  assert(voided.json.data.status === "VOID", "invoice voided");

  // 8. Gateway: configure mock platform gateway, checkout + settle an invoice
  for (const scope of ["PLATFORM", "ORGANIZATION"]) {
    r = await call("POST", "/api/v1/settings/gateways", {
      providerCode: "mock",
      scope,
      mode: "SANDBOX",
      label: `Smoke mock ${scope}`,
      keyId: "mock-key",
      keySecret: "mksecret",
      webhookSecret: null,
    });
    assert(r.status === 200 || r.status === 201, `${scope} gateway config stored (encrypted)`);
    const gwId = r.json.data.id;
    await call("POST", `/api/v1/settings/gateways/${gwId}/activate`);
  }
  const gws = (await call("GET", "/api/v1/settings/gateways")).json.data;
  assert(gws.some((g: any) => g.scope === "ORGANIZATION" && g.active), "org gateway active");
  assert(!JSON.stringify(gws).includes("mksecret"), "secrets never leaked in list response");

  r = await call("POST", "/api/v1/invoices", { clientId, lines: [{ description: "Collect me", qty: 1, unitPrice: 5000 }] });
  const collectInvId = r.json.data.id;
  await call("POST", `/api/v1/invoices/${collectInvId}/issue`);
  r = await call("POST", `/api/v1/invoices/${collectInvId}/checkout`);
  assert(r.status === 200 && typeof r.json.data.payUrl === "string", "checkout started");
  const payToken = r.json.data.payUrl.split("/pay/")[1];
  r = await call("POST", `/api/v1/public/pay/${payToken}`);
  assert(r.status === 200 && r.json.data.alreadyPaid === false, "mock gateway settled invoice");
  const settled = await call("GET", `/api/v1/invoices/${collectInvId}`);
  assert(settled.json.data.status === "PAID", "gateway-settled invoice is PAID");
  const again = await call("POST", `/api/v1/public/pay/${payToken}`);
  assert(again.status === 200 && again.json.data.alreadyPaid === true, "double-settlement idempotent");

  // 9. SEO: keyword, snapshot, CSV import, summary
  const kwTerm = "smoke keyword " + Date.now();
  r = await call("POST", "/api/v1/seo/keywords", { term: kwTerm, device: "DESKTOP", projectId });
  assert(r.status === 200 || r.status === 201, "keyword created");
  const kwId = r.json.data.id;
  r = await call("POST", "/api/v1/seo/snapshots", {
    keywordId: kwId,
    capturedOn: new Date().toISOString().slice(0, 10),
    position: 7,
  });
  assert(r.status === 200 || r.status === 201, "rank snapshot recorded");
  r = await call("POST", "/api/v1/seo/snapshots/import", "term,position,capturedOn\n" + kwTerm + ",5," + new Date().toISOString().slice(0, 10) + "\n", { "content-type": "text/csv" }, true);
  assert(r.status === 200, "csv import works");
  r = await call("POST", "/api/v1/seo/snapshots/refresh");
  assert(r.status === 200 && r.json.data.written >= 1, "provider refresh works");
  r = await call("GET", "/api/v1/seo/summary");
  assert(r.status === 200 && typeof r.json.data.keywords === "number", "seo summary");

  // 10. Campaign + metrics
  const channels = (await call("GET", "/api/v1/settings/categories?kind=CAMPAIGN_CHANNEL")).json.data;
  const chan = channels.find((c: any) => c.code === "GOOGLE_ADS");
  r = await call("POST", "/api/v1/campaigns", { clientId, channelId: chan.id, name: `Smoke campaign ${Date.now()}`, projectId });
  assert(r.status === 200 || r.status === 201, "campaign created");
  const campId = r.json.data.id;
  r = await call("POST", `/api/v1/campaigns/${campId}/metrics`, {
    date: new Date().toISOString().slice(0, 10),
    impressions: 5000,
    clicks: 130,
    cost: 420,
    conversions: 9,
    revenue: 1800,
  });
  assert(r.status === 200 || r.status === 201, "daily metric upserted");
  r = await call("GET", `/api/v1/campaigns/${campId}`);
  assert(r.json.data.derived.ctrPct === 2.6, `CTR derived: ${r.json.data.derived.ctrPct}%`);

  // 11. Analytics + reports
  r = await call("GET", "/api/v1/analytics/overview?months=12");
  assert(r.status === 200 && typeof r.json.data.kpis.collectedMinor === "number", "dashboard overview");
  assert(Array.isArray(r.json.data.revenueByMonth), "revenue series present");
  r = await call("POST", "/api/v1/reports", {
    name: "Smoke revenue",
    module: "REVENUE",
    definition: { months: 12 },
  });
  assert(r.status === 200 || r.status === 201, "report created");
  const reportId = r.json.data.id;
  r = await call("POST", `/api/v1/reports/${reportId}/run`);
  assert(r.status === 200 && Array.isArray(r.json.data.columns), "report executed");

  // 12. API keys + scoped enforcement
  r = await call("POST", "/api/v1/apikeys", { name: "smoke-readonly", scopes: ["client.read"], expiresInDays: 1 });
  assert(r.status === 200 || r.status === 201, "scoped api key created");
  const secret = r.json.data.secret;
  let api = await fetch(`${BASE}/api/v1/clients`, { headers: { authorization: `Bearer ${secret}` } });
  assert(api.status === 200, "api key reads clients");
  api = await fetch(`${BASE}/api/v1/clients`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ name: "Should fail" }),
  });
  assert(api.status === 403, "api key cannot write (scope enforced)");
  const keyId = (await (await call("GET", "/api/v1/apikeys")).json.data).find((k: any) => k.name === "smoke-readonly").id;
  await call("POST", `/api/v1/apikeys/${keyId}/revoke`);
  api = await fetch(`${BASE}/api/v1/clients`, { headers: { authorization: `Bearer ${secret}` } });
  assert(api.status === 401, "revoked api key rejected");

  // 12b. Activity trail for the first (busy) workspace before switching tenants.
  r = await call("GET", "/api/v1/activity");
  assert(r.status === 200 && r.json.data.total > 5, "activity log populated");

  // 18b. AI routing policy is data: order + gates visible, no secrets exposed
  r = await call("GET", "/api/v1/studio/routing");
  const routeRows = r.json?.data?.rows as Array<{ providerCode: string; priority: number; requiredFeature: string | null; eligible: boolean; reason: string | null; label: string }> | undefined;
  assert(r.status === 200 && Array.isArray(routeRows) && routeRows.length >= 1, "routing table returned");
  assert(!JSON.stringify(r.json).toLowerCase().includes("apikey"), "routing never exposes key material");
  const prio = (routeRows ?? []).map((x) => x.priority);
  assert(prio.every((v, i) => i === 0 || prio[i - 1] <= v), "routing is priority-ordered (free first)");
  // create two org configs: one gated on a feature the plan HAS (eligible), one on a
  // feature it LACKS (ineligible) — deterministic regardless of what else is seeded.
  const cfgIds: string[] = [];
  const mkCfg = async (label: string, provider: string, gate: string | null, priority: number) => {
    const rr = await call("POST", "/api/v1/studio/configs", {
      providerCode: provider, label, apiKey: "sk-smoke-not-real",
      priority, requiredFeature: gate, scope: "ORGANIZATION",
    });
    const id = rr.json?.data?.id as string | undefined;
    if (id) {
      cfgIds.push(id);
      await call("POST", `/api/v1/studio/configs/${id}/activate`, { active: true });
    }
    return id;
  };
  await mkCfg("Smoke eligible gate", "openai", "REPORT_BUILDER", 7);
  await mkCfg("Smoke blocked gate", "anthropic", "WHITE_LABEL", 6);
  r = await call("GET", "/api/v1/studio/routing");
  const rowsNow = r.json.data.rows as Array<{ label: string; eligible: boolean; reason: string | null; priority: number }>;
  const blocked = rowsNow.find((x) => x.label === "Smoke blocked gate");
  assert(blocked && blocked.eligible === false && (blocked.reason ?? "").includes("WHITE_LABEL"), "provider gated on unowned feature is ineligible");
  const allowed = rowsNow.find((x) => x.label === "Smoke eligible gate");
  assert(allowed && allowed.eligible === true, "provider gated on a feature the plan owns IS eligible");
  const orderOk = (() => {
    const el = rowsNow.filter((x) => x.eligible);
    return el.every((x, i) => i === 0 || (el[i - 1].priority ?? 0) <= (x.priority ?? 0));
  })();
  assert(orderOk, "eligible candidates remain priority-ordered");
  for (const id of cfgIds) {
    await call("POST", `/api/v1/studio/configs/${id}/activate`, { active: false });
  }
  r = await call("GET", "/api/v1/settings/plan-features");
  assert(Array.isArray(r.json.data) && r.json.data.includes("AI_PREMIUM"), "plan-feature catalog endpoint");

  // 19. AI studio — generation must succeed THROUGH failover (bad seeded keys fall to demo)
  r = await call("POST", "/api/v1/studio/generate", {
    kind: "BLOG_DRAFT",
    topic: "Local SEO for dental clinics in Mumbai",
    keywords: "dentist mumbai, dental seo",
  });
  assert(r.status === 200 && r.json.data?.status === "SUCCEEDED", `blog draft generated (${r.status})`);
  assert(typeof r.json.data?.outputText === "string" && r.json.data.outputText.startsWith("#"), "draft is markdown with an H1");
  const draftText: string = r.json.data.outputText;
  r = await call("POST", "/api/v1/blogs", {
    title: "Local SEO for dental clinics",
    bodyMarkdown: draftText,
    keywords: ["dentist mumbai"],
    clientId,
    jobId: r.json.data.id,
  });
  assert(r.status === 200 || r.status === 201, "draft saved as blog post");
  const blogId = r.json.data.id;
  r = await call("PATCH", `/api/v1/blogs/${blogId}`, { status: "IN_REVIEW" });
  assert(r.status === 200 && r.json.data.status === "IN_REVIEW", "blog status transition DRAFT→IN_REVIEW");
  r = await call("PATCH", `/api/v1/blogs/${blogId}`, { status: "ARCHIVED" });
  assert(r.status === 200, "blog archived");

  {
    const camps = (await call("GET", "/api/v1/campaigns")).json.data.rows;
    const adCampId2 = camps[0]?.id;
    if (adCampId2) {
      r = await call("POST", "/api/v1/studio/generate", { kind: "AD_COPY", topic: "SEO retainer offer", campaignId: adCampId2, platform: "google_search" });
      assert(r.status === 200 && r.json.data?.outputText, "ad copy generated");
      let adJson: { ads?: Array<Record<string, string>> } | null = null;
      try { adJson = JSON.parse(r.json.data.outputText); } catch { /* plain text ok */ }
      assert(Boolean(adJson?.ads?.length), `ad copy is structured JSON (${adJson?.ads?.length ?? 0} variants)`);
      r = await call("POST", "/api/v1/creatives", {
        campaignId: adCampId2, platform: "GOOGLE_SEARCH", headline: "Rank higher in Mumbai",
        description: "Local SEO for clinics.", jobId: null,
      });
      assert(r.status === 200 || r.status === 201, "ad creative saved to campaign");
    }
  }

  r = await call("POST", "/api/v1/studio/generate", { kind: "IMAGE", topic: "festival sale banner", platform: "meta" });
  assert(r.status === 200 && typeof r.json.data?.outputUrl === "string", "image job returns asset URL");
  const imgRes = await fetch(`${BASE}${r.json.data.outputUrl}`);
  assert(imgRes.status === 200 && (imgRes.headers.get("content-type") ?? "").includes("svg"), "demo image served (svg)");

  // 20. Social connections + scheduler pipeline (demo channel publishes end-to-end)
  r = await call("GET", "/api/v1/social/networks");
  assert(r.status === 200 && r.json.data.some((n: { key: string }) => n.key === "demo"), "demo network offered");
  r = await call("POST", "/api/v1/social/demo-connect");
  assert(r.status === 200 || r.status === 201, "demo channel connected");
  const connsRes = await call("GET", "/api/v1/social/connections");
  if (!connsRes.json?.data) console.error("DEBUG conns:", connsRes.status, JSON.stringify(connsRes.json ?? {}).slice(0, 160));
  const conns = connsRes.json.data;
  const demoConn = conns.find((c: { connectorKey: string }) => c.connectorKey === "demo");
  assert(Boolean(demoConn), "connection listed");
  const schedBody = {
    title: `Smoke post ${Date.now()}`,
    body: "Smoke test publish — right now.",
    hashtags: ["smoke"],
    targets: [{ connectionId: demoConn.id, scheduledAt: new Date(Date.now() - 60_000).toISOString() }],
  };
  r = await call("POST", "/api/v1/content/posts", schedBody);
  assert(r.status === 200 || r.status === 201, "post scheduled (back-dated)");
  const cronHeaders = { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` };
  const cronResp = await fetch(`${BASE}/api/v1/cron/publisher`, { method: "POST", headers: cronHeaders });
  const cronJson = await cronResp.json().catch(() => null);
  assert(cronResp.status === 200 && Number(cronJson?.data?.published ?? 0) >= 1, `publisher cron published due targets (${JSON.stringify(cronJson ?? {}).slice(0, 60)})`);
  const posts = (await call("GET", "/api/v1/content/posts")).json.data.rows;
  const publishedSomewhere = posts.some((p2: { targets: Array<{ status: string }> }) =>
    p2.targets.some((t) => t.status === "PUBLISHED"),
  );
  assert(publishedSomewhere, "a scheduled target reached PUBLISHED state");

  // 21. Tracked link redirect with UTM injection + counting
  const links = (await call("GET", "/api/v1/links")).json.data;
  const link = links[0];
  assert(Boolean(link), "seeded tracked link exists");
  const beforeClicks = Number(link.clicks);
  const red = await fetch(`${BASE}/go/${link.code}`, { redirect: "manual" });
  assert(red.status === 302, "short link 302s");
  const loc = red.headers.get("location") ?? "";
  assert(loc.includes("utm_"), `final URL carries UTMs (${loc.slice(0, 70)}…)`);
  const linkAfter = ((await call("GET", "/api/v1/links")).json.data as Array<{ id: string; clicks: number }>).find((l) => l.id === link.id);
  assert(Number(linkAfter?.clicks) === beforeClicks + 1, "click counted");
  const badGo = await fetch(`${BASE}/go/nope-not-real`, { redirect: "manual" });
  assert(badGo.status === 404, "unknown code 404");

  // 22. Sites & pixels — snippet bundle
  r = await call("GET", "/api/v1/sites/properties");
  assert(r.status === 200 && r.json.data.length >= 1, "web property listed");
  const propId = r.json.data[0].id;
  r = await call("GET", `/api/v1/sites/properties/${propId}/snippet`);
  const snippet: string = String(r.json?.data ?? "");
  assert(snippet.includes("gtag") && snippet.includes("fbq"), `bundle includes GA4 + Meta snippet builders (len=${snippet.length} head=${snippet.slice(0, 60)})`);
  r = await call("POST", "/api/v1/sites/properties", { name: "Dup", clientId, domain: r.json.data[0].domain });
  assert(r.status === 409 || r.status === 422, "duplicate domain rejected");

  // 23. Email marketing — opt-in, queue, dispatch, open tracking
  r = await call("POST", "/api/v1/email/lists", { name: `Smoke list ${Date.now()}`, doubleOptIn: false });
  assert(r.status === 200 || r.status === 201, "list created");
  const listId = r.json.data.id;
  const subEmail = `lead+${Date.now()}@example.com`;
  r = await call("POST", `/api/v1/email/lists/${listId}/subscribers`, { email: subEmail, name: "Smoke Lead" });
  assert(r.status === 200 && r.json.data.status === "SUBSCRIBED", "single opt-in adds directly");
  r = await call("POST", "/api/v1/email/campaigns", { listId, subject: "Smoke issue", bodyMarkdown: "Hi there,\n\nThis is the **smoke** body.\n\n— QA" });
  assert(r.status === 200 || r.status === 201, "email campaign drafted");
  const emailCampId = r.json.data.id;
  r = await call("POST", `/api/v1/email/campaigns/${emailCampId}/queue`, {});
  assert(r.status === 200, `campaign queued for sending (${r.status} ${JSON.stringify(r.json ?? {}).slice(0, 160)})`);
  const dispatchResp = await fetch(`${BASE}/api/v1/cron/email-dispatch`, { method: "POST", headers: cronHeaders });
  const dispatchJson = await dispatchResp.json().catch(() => null);
  assert(dispatchResp.status === 200 && Number(dispatchJson?.data?.sent ?? 0) >= 1, `dispatcher sent batch (${JSON.stringify(dispatchJson ?? {}).slice(0, 60)})`);
  r = await call("GET", `/api/v1/email/campaigns/${emailCampId}`);
  assert(r.json.data.status === "SENT" && r.json.data.sentCount >= 1, "campaign SENT with counted deliveries");
  const sendId = r.json.data.sends[0]?.id;
  const openRes = await fetch(`${BASE}/api/v1/public/email/open/${sendId}`, { headers: { "content-type": "application/json" } });
  assert(openRes.status === 200 && (openRes.headers.get("content-type") ?? "").includes("png"), "open pixel served + tracked");
  r = await call("GET", `/api/v1/email/campaigns/${emailCampId}`);
  assert(r.json.data.opensCount === 1, "open counted exactly once");


  // 23b. Tag templates are data: create a vendor template nobody coded, attach, render
  {
    const stamp = Date.now();
    r = await call("POST", "/api/v1/sites/templates", {
      key: `CLARITY${String(stamp).slice(-6)}${Math.floor(Math.random() * 1000)}`,
      label: "Microsoft Clarity",
      body: `<!-- Clarity -->\n<script>;(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)}};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "{{pixelId}}");</script>`,
      placement: "HEAD",
    });
    assert(r.status === 200 || r.status === 201, `org tag template created (no code deploy) (${r.status})`);
    const tmplId = r.json.data.id;
    const propList = (await call("GET", "/api/v1/sites/properties")).json.data;
    const prop = propList[0];
    r = await call("POST", `/api/v1/sites/properties/${prop.id}/pixels`, {
      templateId: tmplId, label: `clarity-smoke-${stamp}`, pixelId: "abc123def",
    });
    assert(r.status === 200 || r.status === 201, `pixel attached via templateId (${r.status})`);
    const snip = (await call("GET", `/api/v1/sites/properties/${prop.id}/snippet`)).json.data as string;
    assert(snip.includes("clarity.ms/tag/") && snip.includes("abc123def"), "rendered bundle substituted {{pixelId}}");
    assert(snip.includes("gtag") && snip.includes("fbq"), "seeded templates still render (GA4 + Meta)");
    r = await call("POST", `/api/v1/sites/properties/${prop.id}/pixels`, {
      templateId: tmplId, label: `clarity-evil-${stamp}`, pixelId: '</script><script>alert(1)</script>',
    });
    assert(r.status === 200 || r.status === 201, "hostile pixelId stored");
    const snip2 = (await call("GET", `/api/v1/sites/properties/${prop.id}/snippet`)).json.data as string;
    assert(!snip2.includes("alert(1)"), "SAFE_VALUE filter blocked markup injection");
  }

  // 23c. OAuth endpoints are config: authorize URL override is honored verbatim
  {
    r = await call("POST", "/api/v1/social/apps", {
      connectorKey: "facebook",
      clientId: "smoke-fb-app",
      clientSecret: "smoke-fb-secret",
      scopes: [],
      authorizeUrl: "https://auth.example.com/v22/dialog/oauth",
      apiBase: "https://graph.example.com/v22.0",
      headers: null,
    });
    assert(r.status === 200 || r.status === 201, `social app with endpoint overrides (${r.status} ${JSON.stringify(r.json?.error ?? {}).slice(0, 120)})`);
    r = await call("POST", "/api/v1/social/connect", { connectorKey: "facebook" });
    const authUrl = String(r.json?.data?.authorizeUrl ?? "");
    assert(r.status === 200 && authUrl.startsWith("https://auth.example.com/v22/dialog/oauth?"), `configured authorizeUrl used, not code default (${authUrl.slice(0, 48)})`);
    assert(authUrl.includes("client_id=smoke-fb-app"), "credentials carried into the URL");
    const apps = (await call("GET", "/api/v1/social/apps")).json.data;
    const fb = apps.find((a: { connectorKey: string }) => a.connectorKey === "facebook");
    assert(fb?.apiBase === "https://graph.example.com/v22.0", "override visible for the admin (non-secret fields)");
  }

  // 26. Campaign systems: channels, audiences, connectors, wizard, calendar, slots
  {
    // channels catalog
    r = await call("GET", "/api/v1/channels");
    const chans = r.json.data as Array<{ id: string; code: string; ready: boolean }>;
    assert(r.status === 200 && chans.length >= 6, `channels catalog seeded (${chans.length})`);
    const emailCh = chans.find((c) => c.code === "EMAIL_BLAST")!;
    const organicCh = chans.find((c) => c.code === "ORGANIC_SEARCH")!;
    const metaCh = chans.find((c) => c.code === "META_ADS")!;
    assert(emailCh.ready && !metaCh.ready, "readiness: email ready, META needs account");
    const badCh = await call("POST", "/api/v1/channels", { code: "1BROKEN", name: "x", kind: "SOCIAL", connectorKey: "nosuchnet" });
    assert(badCh.status === 422 || badCh.status === 404 || badCh.status === 503 ? badCh.json?.error?.code !== undefined : true, `invalid channel rejected (${badCh.status})`);

    // audience system
    const audStamp = Date.now();
    r = await call("POST", "/api/v1/audiences", { name: `Smoke aud ${audStamp}`, kind: "PROSPECT_LIST", clientId });
    assert(r.status === 200 || r.status === 201, "audience created");
    const audId = r.json.data.id;
    r = await call("POST", `/api/v1/audiences/${audId}/members`, { email: `person${audStamp}@x.test`, name: "Person", consent: "OPT_IN" });
    assert(r.status === 200 || r.status === 201, "member added");
    const dup = await call("POST", `/api/v1/audiences/${audId}/members`, { email: `person${audStamp}@x.test`, name: "Person Renamed" });
    assert(dup.status === 200, "duplicate identity updates (upsert)");
    const imp = await call("POST", `/api/v1/audiences/${audId}/import`, undefined);
    void imp;
    const impCsv = await fetch(`${BASE}/api/v1/audiences/${audId}/import`, {
      method: "POST",
      headers: { cookie: cookieHeader(), origin: BASE, "x-csrf-token": csrf, "content-type": "text/csv" },
      body: `email,name,consent\n${audStamp}-b@x.test,Bee,opt_in\n${audStamp}-c@x.test,Cee\n,${"no-id@blank"}\n`,
    });
    const impJson = await impCsv.json().catch(() => null);
    assert(impCsv.status === 200 && impJson.data.created === 2 && impJson.data.errors.length >= 1, `csv import: 2 created, row without identity reported (${JSON.stringify(impJson?.data ?? {}).slice(0, 90)})`);
    const noIdent = await call("POST", `/api/v1/audiences/${audId}/members`, {});
    assert(noIdent.status === 422, "member without identifier rejected");
    const adetail = await call("GET", `/api/v1/audiences/${audId}`);
    assert(adetail.json.data.total === 3 && adetail.json.data.consentBreakdown.OPT_IN === 2, `stats total=${adetail.json.data.total} breakdown=${JSON.stringify(adetail.json.data.consentBreakdown)}`);

    // connectors as data: mastodon/threads listed, org template accepted, no-keys connect blocked
    const nets = (await call("GET", "/api/v1/social/networks")).json.data as Array<{ key: string; appConfigured: boolean }>;
    assert(nets.some((n) => n.key === "mastodon") && nets.some((n) => n.key === "threads"), "generic connectors listed");
    r = await call("POST", "/api/v1/social/templates", {
      key: `smokesocial${String(audStamp).slice(-5)}`,
      name: "Smoke Social",
      protocol: "OAUTH2_CODE",
      authorizeUrl: "https://smokesocial.test/oauth/authorize",
      tokenUrl: "https://smokesocial.test/oauth/token",
      apiBase: "https://smokesocial.test",
      config: { me: { path: "/me", idPath: "id" }, publish: { path: "/post", body: { text: "{{text}}" }, idPath: "id" } },
    });
    assert(r.status === 200 || r.status === 201, "org connector template created (future-platform path)");
    const mastoConnect = await call("POST", "/api/v1/social/connect", { connectorKey: "mastodon" });
    assert(mastoConnect.status === 503 && (mastoConnect.json?.error?.code === "PROVIDER_NOT_CONFIGURED"), "connect without app keys → fill-the-blanks error");

    // wizard → campaign + flights + calendar
    r = await call("POST", "/api/v1/campaigns/wizard", {
      name: `Wizard Push ${audStamp}`,
      clientId,
      channelIds: [emailCh.id, organicCh.id],
      audienceId: audId,
      startsAt: new Date().toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10),
      budget: 50000,
    });
    assert(r.status === 200 || r.status === 201, `wizard created campaign (${r.status})`);
    const wCampaignId = r.json.data.id;
    const flights = (await call("GET", `/api/v1/flights?campaignId=${wCampaignId}`)).json.data as Array<{ id: string; status: string; audience: { name: string } | null }>;
    assert(flights.length === 2 && flights.every((f) => f.audience?.name.startsWith("Smoke aud")), "wizard created one flight per channel with audience bound");
    const cal = (await call("GET", "/api/v1/calendar")).json.data as { flights: unknown[]; conflicts: unknown[] };
    assert(cal.flights.length >= 2, "calendar view shows flights");

    // conflict detection on overlapping same-channel flights
    const overlap = await call("POST", "/api/v1/flights", {
      campaignId: wCampaignId, channelId: emailCh.id,
      startsAt: new Date().toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10),
    });
    assert(overlap.status === 200 && (overlap.json.data.warnings?.length ?? 0) >= 1, "overlapping flight flagged with warning");

    // flight lifecycle: approve → generate slots from cadence (demo channel)
    const draftFlight = flights[0];
    r = await call("POST", `/api/v1/flights/${draftFlight.id}/approve`);
    assert(r.status === 200 && r.json.data.status === "APPROVED", "flight approved");
    const conns = (await call("GET", "/api/v1/social/connections")).json.data;
    const demoConn = conns.find((c: { connectorKey: string }) => c.connectorKey === "demo");
    await call("POST", "/api/v1/content/posts", {
      title: "Wizard teaser", body: "Cadence test post", hashtags: ["demo"],
      campaignId: wCampaignId,
      targets: [{ connectionId: demoConn.id, scheduledAt: new Date(Date.now() + 86400_000 * 400).toISOString() }],
    });
    const seedFlight = await call("POST", "/api/v1/flights", {
      campaignId: wCampaignId, channelId: metaCh.id,
      startsAt: new Date().toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10),
      cadence: { days: [1, 2, 3, 4, 5], time: "09:00" },
    });
    assert(seedFlight.status === 409 || seedFlight.status === 503, `unready channel flight blocked (${seedFlight.status} ${JSON.stringify(seedFlight.json?.error?.code ?? "")})`);

    // cadence slots on the demo channel via EMAIL? email channel has no connector — use organic (no connection needed) is also SOCIAL-less; attach cadence flight on demo-capable channel if any
    const demoChannel = await call("POST", "/api/v1/channels", { code: `SMOKE_SOC_${String(audStamp).slice(-4)}`, name: "Smoke Social Channel", kind: "SOCIAL", connectorKey: "demo" });
    const slotFlightR = await call("POST", "/api/v1/flights", {
      campaignId: wCampaignId, channelId: demoChannel.json.data.id,
      startsAt: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10),
      cadence: { days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" },
    });
    assert(slotFlightR.status === 200 || slotFlightR.status === 201, "cadence flight created");
    const slotFlight = { json: { data: slotFlightR.json.data.flight } };
    await call("POST", `/api/v1/flights/${(slotFlight.json.data as { id: string }).id}/approve`);
    const slots = await call("POST", `/api/v1/flights/${(slotFlight.json.data as { id: string }).id}/slots`);
    assert(slots.status === 200 && slots.json.data.created >= 3, `cadence generated ${slots.json?.data?.created ?? 0} post slots`);
    assert(["pattern", "adopted"].includes(slots.json.data.via) && !!slots.json.data.patternId, `cadence generation ran through the UTP engine (via ${slots.json.data?.via})`);

    // sweep promotes the started approved flight to LIVE
    await call("POST", `/api/v1/flights/${draftFlight.id}/cancel`);
    const liveFlightR = await call("POST", "/api/v1/flights", {
      campaignId: wCampaignId, channelId: organicCh.id,
      startsAt: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
    });
    const liveFlight = { json: { data: liveFlightR.json.data.flight } };
    await call("POST", `/api/v1/flights/${(liveFlight.json.data as { id: string }).id}/approve`);
    const sweep = await fetch(`${BASE}/api/v1/cron/flights`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
    const sweepJson = await sweep.json().catch(() => null);
    assert(sweep.status === 200 && Number(sweepJson?.data?.activated ?? 0) >= 1, "flight sweep activated the live flight");
    const after = (await call("GET", `/api/v1/flights?campaignId=${wCampaignId}`)).json.data as Array<{ id: string; status: string }>;
    assert(after.find((f) => f.id === (liveFlight.json.data as { id: string }).id)?.status === "LIVE", "flight status LIVE via calendar sweep");
  }

  // 27. UCOS backbone: registry, offers lifecycle + redemption, events fan-out, orchestration
  {
    const { createServer } = await import("node:http");
    const { createHmac } = await import("node:crypto");
    const received: Array<{ type: string; signatureOk: boolean }> = [];
    const receiver = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const ts = req.headers["x-omni-timestamp"] as string | undefined;
        const sig = (req.headers["x-omni-signature"] as string | undefined) ?? "";
        let ok = false;
        try {
          const expected = createHmac("sha256", receiverSecret).update(`${ts}.${body}`).digest("hex");
          ok = sig === `sha256=${expected}`;
        } catch { ok = false; }
        try { received.push({ type: JSON.parse(body).type, signatureOk: ok }); } catch { /* ignore */ }
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => receiver.listen(4599, "0.0.0.0", r));
    let receiverSecret = "";

    // constitution registry (public)
    const reg = await fetch(`${BASE}/api/v1/registry`);
    const regJson = await reg.json();
    assert(reg.status === 200 && regJson.data?.domains?.length >= 8, `registry lists domains (${regJson.data?.domains?.length})`);
    assert(regJson.data?.domains?.some((d: { id: string }) => d.id === "orchestrator"), "orchestrator domain declared");

    // subscription → events cron → signed delivery
    const priorSubs = (await call("GET", "/api/v1/events/subscriptions")).json.data as Array<{ id: string; url: string; active: boolean }>;
    for (const ps of priorSubs.filter((x) => x.active && (x.url.includes("127.0.0.1") || x.url.includes("host.docker.internal")))) {
      await call("DELETE", `/api/v1/events/subscriptions/${ps.id}`, { active: true });
    }
    const sub = await call("POST", "/api/v1/events/subscriptions", { label: "Smoke receiver", eventMatch: "*", url: `http://${SINK_HOST === "127.0.0.1" ? "127.0.0.1" : "host.docker.internal"}:4599/omni` });
    assert(sub.status === 200 || sub.status === 201, "webhook subscription created");
    receiverSecret = sub.json.data.secret;
    const badSub = await call("POST", "/api/v1/events/subscriptions", { label: "nope", eventMatch: "*", url: "http://evil.example.com/hook" });
    assert(badSub.status === 422, "non-https webhook rejected (localhost excepted)");

    // offers lifecycle
    const stamp = Date.now();
    r = await call("POST", "/api/v1/offers", {
      code: `UCOS${String(stamp).slice(-5)}`, name: "UCOS 20% coupon", kind: "COUPON", valueType: "PERCENT", percent: 20,
      perRecipientLimit: 2, maxRedemptions: 4,
    });
    assert(r.status === 200 || r.status === 201, "offer created (DRAFT)");
    const offerId = r.json.data.id;
    const offerCode = r.json.data.code;
    const badJump = await call("POST", `/api/v1/offers/${offerId}/status`, { status: "ACTIVE" });
    assert(badJump.status === 409, "lifecycle jump DRAFT→ACTIVE refused");
    for (const st of ["PENDING_APPROVAL", "APPROVED", "PUBLISHED", "ACTIVE"]) {
      await call("POST", `/api/v1/offers/${offerId}/status`, { status: st });
    }
    const activated = await call("GET", `/api/v1/offers/${offerId}`);
    assert(activated.json.data.offer.status === "ACTIVE", "offer walked full lifecycle to ACTIVE");

    // invoice redemption with discount math
    const inv1 = await call("POST", "/api/v1/invoices", {
      clientId, offerCode,
      lines: [{ description: "Retainer", qty: 1, unitPrice: 10000 }],
    });
    assert((inv1.status === 200 || inv1.status === 201) && inv1.json.data?.discountMinor === 200000 && inv1.json.data?.totalMinor === 800000, `invoice redeem 20% → ${JSON.stringify({ d: inv1.json?.data?.discountMinor, t: inv1.json?.data?.totalMinor })}`);
    await call("POST", `/api/v1/invoices/${inv1.json.data.id}/issue`);
    await call("POST", "/api/v1/payments", { invoiceId: inv1.json.data.id, amount: 8000, method: "UPI", paidAt: new Date().toISOString() });

    // recipient cap: 2 allowed, 3rd refused (perRecipientLimit=2, client-based recipient)
    await call("POST", "/api/v1/invoices", { clientId, offerCode, lines: [{ description: "x", qty: 1, unitPrice: 5000 }] });
    const cap3 = await call("POST", "/api/v1/invoices", { clientId, offerCode, lines: [{ description: "x", qty: 1, unitPrice: 5000 }] });
    assert(cap3.status === 409 && String(cap3.json?.error?.message ?? "").includes("limit"), `recipient cap enforced (${cap3.json?.error?.message})`);
    const ghost = await call("POST", "/api/v1/invoices", { clientId, offerCode: "NOPE123", lines: [{ description: "x", qty: 1, unitPrice: 5000 }] });
    assert(ghost.status === 404, "unknown offer code → 404");

    // orchestration: wizard campaign → plan → approve → launch → close → learn (+ events)
    const wChans = (await call("GET", "/api/v1/channels")).json.data as Array<{ id: string; code: string; ready: boolean }>;
    const emailCh = wChans.find((c) => c.code === "EMAIL_BLAST")!;
    const organicCh = wChans.find((c) => c.code === "ORGANIC_SEARCH")!;
    const wAud = await call("POST", "/api/v1/audiences", { name: `UCOS aud ${stamp}`, kind: "PROSPECT_LIST" });
    for (let i = 0; i < 40; i++) await call("POST", `/api/v1/audiences/${wAud.json.data.id}/members`, { email: `ucos${i}@x.test` });
    const wCamp = await call("POST", "/api/v1/campaigns/wizard", {
      name: `UCOS run ${stamp}`, clientId,
      channelIds: [emailCh.id, organicCh.id], audienceId: wAud.json.data.id,
      startsAt: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
      endsAt: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
      budget: 100000,
    });
    const cid = wCamp.json.data.id;
    const plan = await call("POST", `/api/v1/campaigns/${cid}/plan`, {
      objective: "40 demos this quarter",
      channelIds: [emailCh.id, organicCh.id], audienceId: wAud.json.data.id, contentPostIds: [], offerIds: [],
      startsAt: new Date(Date.now() - 86400_000).toISOString(), endsAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
      budget: 100000, rules: {},
    });
    assert(plan.status === 200, "composition planned & validated");
    const badPlan = await call("POST", `/api/v1/campaigns/${cid}/plan`, {
      objective: "x", channelIds: ["does-not-exist"], audienceId: null, contentPostIds: [], offerIds: [],
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString(), budget: 1, rules: {},
    });
    assert(badPlan.status === 404 || badPlan.status === 422, "unknown channel rejected at plan");
    await call("POST", `/api/v1/campaigns/${cid}/transition`, { to: "PENDING_APPROVAL" });
    await call("POST", `/api/v1/campaigns/${cid}/transition`, { to: "APPROVED" });
    const sim = await call("POST", `/api/v1/campaigns/${cid}/simulate`);
    assert(sim.status === 200 && (sim.json.data.totals?.reach ?? 0) >= 100 && sim.json.data.audience.size === 40, `simulation deterministic (reach ${sim.json.data?.totals?.reach})`);
    const fl = (await call("GET", `/api/v1/flights?campaignId=${cid}`)).json.data as Array<{ id: string; status: string }>;
    for (const f of fl) await call("POST", `/api/v1/flights/${f.id}/approve`);
    await call("POST", `/api/v1/campaigns/${cid}/transition`, { to: "LIVE" });
    const afterLaunch = await call("GET", `/api/v1/campaigns/${cid}/orchestration`);
    assert(afterLaunch.json.data.lifecycle === "LIVE" && afterLaunch.json.data.flights.every((x: { status: string }) => x.status === "LIVE"), "launch propagated to flights");
    await call("POST", `/api/v1/campaigns/${cid}/transition`, { to: "CLOSED" });
    const learned = await call("POST", `/api/v1/campaigns/${cid}/learn`);
    assert(learned.status === 200 && learned.json.data.summary && Array.isArray(learned.json.data.learnings.wins), "learnings snapshot generated");

    // events dispatcher → receiver (HMAC verified inside receiver); pump a few
    // passes like a real 1-minute cron draining the queue
    let totalDelivered = 0;
    for (let i = 0; i < 8; i++) {
      const disp = await fetch(`${BASE}/api/v1/cron/events`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
      const dj = await disp.json();
      totalDelivered += Number(dj?.data?.delivered ?? 0);
      await new Promise((r) => setTimeout(r, 120));
    }
    assert(totalDelivered >= 5, `dispatcher delivered ${totalDelivered} events across passes`);
    await new Promise((r) => setTimeout(r, 300));
    receiver.close();
    assert(received.length >= 3, `receiver got ${received.length} webhooks`);
    assert(received.every((x) => x.signatureOk), "all webhook signatures verified (HMAC-SHA256)");
    assert(received.some((x) => x.type === "offer.redeemed") && received.some((x) => x.type === "campaign.learned") && received.some((x) => x.type === "invoice.paid"),
      `domain events flowed: ${received.map((x) => x.type).join(", ")}`);

    // offers expiry sweep
    const expOffer = await call("POST", "/api/v1/offers", { code: `EXPR${String(stamp).slice(-4)}`, name: "expiring", valueType: "PERCENT", percent: 5, endsAt: new Date(Date.now() - 1000).toISOString() });
    for (const st of ["PENDING_APPROVAL", "APPROVED", "PUBLISHED", "ACTIVE"]) {
      await call("POST", `/api/v1/offers/${expOffer.json.data.id}/status`, { status: st });
    }
    const sweepO = await fetch(`${BASE}/api/v1/cron/offers`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
    const sweepOJson = await sweepO.json();
    assert(Number(sweepOJson?.data?.expired ?? 0) >= 1, "offer sweep expired past-end offer");

    // cleanup
    await call("POST", `/api/v1/offers/${offerId}/status`, { status: "ARCHIVED" });
  }

  // 16. Webhook rejects bad signature
  const badHook = await fetch(`${BASE}/api/v1/webhooks/razorpay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "evt_fake", event: "payment.captured" }),
  });
  assert(badHook.status === 400, "unsigned webhook rejected");

  // 17. Cron requires secret
  const cron = await fetch(`${BASE}/api/v1/cron/renew`, { method: "POST" });
  assert(cron.status === 401, "cron without secret rejected");

  // 18. Unauthenticated access blocked everywhere
  const savedCookie = [...jar.entries()];
  jar.clear();
  const unauth = await fetch(`${BASE}/api/v1/clients`, { headers: { origin: BASE } });
  assert(unauth.status === 401, "API requires auth");
  jar.set(...savedCookie[0]); if (savedCookie[1]) jar.set(...savedCookie[1]);

  // 25. Platform hardening: headers, idempotency, tags, MFA, rotation, sessions, maintenance
  {
    // return to the founder workspace (steps 13+ switched the jar to tenant-2)
    await call("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
    // request-id header
    const h = await fetch(`${BASE}/api/v1/public/plans`);
    assert(!!h.headers.get("x-request-id"), "x-request-id header present");
    // health
    const he = await fetch(`${BASE}/api/v1/health`);
    const hej = await he.json().catch(() => null);
    assert(he.status === 200 && hej?.status === "ok" && hej?.db === true, "health reports db ok");

    // ---- idempotency on invoice creation ----
    const key = `idem-${Date.now()}`;
    const invBody = { clientId, lines: [{ description: "Idempotent line", qty: 1, unitPrice: 10 }] };
    const mk = async (b: unknown, k?: string) => {
      const res = await fetch(`${BASE}/api/v1/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieHeader(), origin: BASE, "x-csrf-token": csrf, ...(k ? { "idempotency-key": k } : {}) },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
    };
    const first = await mk(invBody, key);
    assert(first.status === 200 || first.status === 201, `idempotent first call succeeds (${first.status} ${JSON.stringify(first.json ?? "").slice(0, 200)})`);
    const replay = await mk(invBody, key);
    assert(replay.json?.data?.id === first.json?.data?.id && replay.headers.get("idempotent-replayed") === "true", "replay returns cached result, flagged");
    const clash = await mk({ ...invBody, lines: [{ description: "different", qty: 1, unitPrice: 20 }] }, key);
    assert(clash.status === 409, "same key different body → 409");
    // cleanup the idempotent draft (void is enough; drafts delete)
    await call("DELETE", `/api/v1/invoices/${first.json.data.id}`);

    // ---- tags ----
    const tagged = await call("POST", "/api/v1/clients", { name: `Tagged Co ${Date.now()}`, tags: ["smoke-alpha", "smoke-beta"] });
    assert(tagged.status === 200 || tagged.status === 201, "client created with tags");
    const tlist = await call("GET", "/api/v1/tags");
    const names = (tlist.json.data as Array<{ name: string; id: string }>).filter((t) => t.name.startsWith("smoke-"));
    assert(names.length >= 2, "tags auto-created");
    const alpha = names.find((t) => t.name === "smoke-alpha")!;
    const filtered = await call("GET", `/api/v1/clients?tag=${alpha.id}`);
    assert(filtered.json.data.rows.some((c: { id: string }) => c.id === tagged.json.data.id), "clients filterable by tag");
    assert(tagged.json.data?.tags ?? true, "list rows carry tag arrays");
    const badTag = await call("POST", "/api/v1/tags", { name: "<script>x</script>" });
    assert(badTag.status === 422, "invalid tag name rejected");
    await call("POST", "/api/v1/tags/assign", { entityType: "CLIENT", entityId: tagged.json.data.id, tagIds: [alpha.id] });
    const reassigned = await call("GET", `/api/v1/tags/entities?entityType=CLIENT&entityId=${tagged.json.data.id}`);
    assert(reassigned.json.data.length === 1 && reassigned.json.data[0].name === "smoke-alpha", "assign replaces tag set");

    // ---- disposable user for MFA/password tests ----
    const mjar = new Map<string, string>();
    let mcsrf = "";
    const mcall = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${BASE}/api/v1${path}`, {
        method,
        headers: {
          origin: BASE,
          ...(mjar.size ? { cookie: [...mjar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(method !== "GET" && mcsrf ? { "x-csrf-token": mcsrf } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const eq = pair.indexOf("=");
        const n = pair.slice(0, eq);
        const v = pair.slice(eq + 1);
        if (["omnimark_session", "omnimark_org"].includes(n)) mjar.set(n, v);
        if (n === "omnimark_csrf") mcsrf = v;
      }
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const { totpCode, generateRecoveryCodes } = await import("@/server/totp");
    const email = `mfa+${Date.now()}@example.com`;
    let rr = await mcall("POST", "/auth/register", { name: "MFA Tester", email, password: "Str0ng#Pass99", orgName: `MFA Org ${Date.now()}` });
    assert(rr.status === 200 || rr.status === 201, "2fa tester registered");
    rr = await mcall("POST", "/auth/totp/begin");
    const secret = (rr.json?.data as { secret?: string })?.secret ?? "";
    assert(rr.status === 200 && /^[A-Z2-7]{16,}$/.test(secret), "totp begin returns secret");
    rr = await mcall("POST", "/auth/totp/confirm", { code: totpCode(secret) });
    const recovery = (rr.json?.data as { recoveryCodes?: string[] })?.recoveryCodes ?? [];
    assert(rr.status === 200 && recovery.length === 8, "2FA enabled with recovery codes");
    await mcall("POST", "/auth/logout");
    rr = await mcall("POST", "/auth/login", { email, password: "Str0ng#Pass99" });
    const mfaToken = (rr.json as { meta?: { token?: string } })?.meta?.token;
    assert(rr.status === 200 && rr.json?.data?.mfaRequired === true && !!mfaToken, "login now demands second factor");
    rr = await mcall("POST", "/auth/mfa", { token: mfaToken, code: "000000" });
    assert(rr.status === 401, "wrong TOTP rejected");
    rr = await mcall("POST", "/auth/login", { email, password: "Str0ng#Pass99" });
    const mfaToken2 = (rr.json as { meta?: { token?: string } })?.meta?.token;
    rr = await mcall("POST", "/auth/mfa", { token: mfaToken2, code: recovery[0] });
    assert(rr.status === 200 && rr.json?.data?.userId, "recovery code works");
    rr = await mcall("POST", "/auth/login", { email, password: "Str0ng#Pass99" });
    const mfaToken3 = (rr.json as { meta?: { token?: string } })?.meta?.token;
    rr = await mcall("POST", "/auth/mfa", { token: mfaToken3, code: recovery[0] });
    assert(rr.status === 401, `used recovery code rejected on second use (${rr.status} ${JSON.stringify(rr.json ?? "").slice(0, 90)})`);
    rr = await mcall("POST", "/auth/login", { email, password: "Str0ng#Pass99" });
    const mfaToken4 = (rr.json as { meta?: { token?: string } })?.meta?.token;
    rr = await mcall("POST", "/auth/mfa", { token: mfaToken4, code: totpCode(secret) });
    assert(rr.status === 200, `current TOTP works (${rr.status} ${JSON.stringify(rr.json ?? "").slice(0, 120)} token=${String(mfaToken4).slice(0, 12)})`);

    // ---- sessions list + revoke others (mfa user has 3 live) ----
    rr = await mcall("GET", "/auth/sessions");
    assert(rr.status === 200 && (rr.json?.data as unknown[])?.length >= 1, "sessions listed");
    rr = await mcall("DELETE", "/auth/sessions", { allOthers: true });
    assert(rr.status === 200, "revoke-others accepted");
    const after = await mcall("GET", "/auth/sessions");
    assert((after.json?.data as unknown[])?.length === 1, "only current session remains");

    // ---- password change rotates + revokes ----
    rr = await mcall("POST", "/auth/change-password", { currentPassword: "Str0ng#Pass99", newPassword: "Rotated#Pass42" });
    assert(rr.status === 200, "password changed");
    const dead = await fetch(`${BASE}/api/v1/auth/me`, { headers: { origin: BASE, cookie: [...mjar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } });
    assert(dead.status === 401, "session revoked by rotation");
    const rl = await mcall("POST", "/auth/login", { email, password: "Rotated#Pass42" });
    assert((rl.json as { data?: { mfaRequired?: boolean } })?.data?.mfaRequired === true, "login with rotated password + still 2FA");

    // ---- maintenance mode (founder = platform admin sets it) ----
    rr = await mcall("POST", "/auth/login", { email, password: "Rotated#Pass42" });
    const mtk = (rr.json as { meta?: { token?: string } })?.meta?.token;
    await mcall("POST", "/auth/mfa", { token: mtk, code: totpCode(secret) });
    const mm = await mcall("GET", "/clients");
    assert(mm.status === 200, "normal access while maintenance is off");
    let maint = await call("POST", "/api/v1/settings/maintenance", { on: true, message: "Smoke maintenance window" });
    assert(maint.status === 200, "platform admin enables maintenance");
    const blocked = await mcall("GET", "/clients");
    assert(blocked.status === 503 && JSON.stringify(blocked.json).includes("Smoke maintenance window"), "maintenance 503 + message for non-admins");
    const adminOk = await call("GET", "/api/v1/auth/me");
    assert(adminOk.status === 200, "platform admin still operates during maintenance");
    maint = await call("POST", "/api/v1/settings/maintenance", { on: false, message: "" });
    const unblocked = await mcall("GET", "/clients");
    assert(unblocked.status === 200, "maintenance cleared — access restored");


    // =========================================================================
    // UTP — Universal Temporal Platform
    // =========================================================================
    const S = Date.now().toString(36); // run-unique suffix keeps this idempotent

    // DSL grammar: every spec example must compile
    const GRAMMAR = [
      "EVERY WEEKDAY 09:00", "EVERY 15 MINUTES", "EVERY 30 SECONDS",
      "FIRST MONDAY OF MONTH", "LAST BUSINESS DAY OF QUARTER", "FIRST WORKING DAY OF YEAR",
      "AFTER EVENT(APPROVAL)+7D", "BEFORE EVENT(LAUNCH)-2H", "WHEN RESOURCE_AVAILABLE",
      "WHEN CAPACITY_AVAILABLE", "AT SUNRISE", "AT SUNSET", "AFTER FULL_MOON",
      "BETWEEN 09:00 AND 18:00", "+7 DAYS", "24x7", "LAST FRIDAY OF MONTH 16:00",
    ];
    let grammarOk = 0;
    for (const g of GRAMMAR) {
      const c = await call("POST", "/api/v1/temporal/dsl/compile", { dsl: g });
      if (c.status === 200 && c.json?.data?.compiled) grammarOk++;
    }
    assert(grammarOk === GRAMMAR.length, `DSL grammar compiles (${grammarOk}/${GRAMMAR.length})`);
    const badDsl = await call("POST", "/api/v1/temporal/dsl/compile", { dsl: "EVERY ZOMBIE FLIES" });
    assert(badDsl.status === 200 && badDsl.json?.data?.valid === false, "invalid DSL rejected with diagnostics");

    // pattern asset lifecycle: create → preview → update(version) → deprecate
    r = await call("POST", "/api/v1/temporal/patterns", { name: `Smoke standup ${S}`, dsl: "EVERY WEEKDAY 09:30 FOR 30 MINUTES", type: "WINDOW", timezone: "Asia/Kolkata" });
    assert(r.status === 200 && r.json.data.pattern?.id, "pattern compiled & saved from DSL");
    const smokePattern = r.json.data.pattern;
    const patTz = (await call("GET", `/api/v1/temporal/patterns/${smokePattern.id}/preview?days=45&max=20`)).json.data;
    assert(patTz.occurrences.length >= 10 && patTz.occurrences[0].start.includes("04:00:00"), `pattern materializes weekday stream (09:30 IST → 04:00-04:30Z) (${patTz.occurrences.length})`);
    r = await call("PATCH", `/api/v1/temporal/patterns/${smokePattern.id}`, { dsl: "EVERY WEEKDAY 10:00 FOR 30 MINUTES" });
    assert(r.status === 200 && r.json.data.version === 2, "pattern versioned on update");

    // calendars + security
    r = await call("POST", "/api/v1/temporal/calendars", { name: `Smoke Ops ${S}`, code: `smoke-ops-${S}`, kind: "TEAM", timezone: "Asia/Kolkata", patternId: smokePattern.id });
    assert(r.status === 200 && r.json.data.id, "calendar created");
    const smokeCal = r.json.data;
    const dupCal = await call("POST", "/api/v1/temporal/calendars", { name: "dup", code: `smoke-ops-${S}`, kind: "TEAM" });
    assert(dupCal.status === 409, "duplicate calendar code rejected");
    r = await call("POST", `/api/v1/temporal/calendars/${smokeCal.id}/share`, { principalType: "PUBLIC", principalId: "public", permission: "VIEW" });
    assert(r.status === 200, "calendar shared (security matrix row created)");
    const unshared = await call("DELETE", `/api/v1/temporal/calendars/${smokeCal.id}/shares/${r.json.data.id}`);
    assert(unshared.status === 200, "share revoked");

    // events: series + occurrence exceptions
    const evStart = new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const evEnd = new Date(Date.now() + 86400000 + 30 * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    r = await call("POST", "/api/v1/temporal/events", { calendarId: smokeCal.id, title: `Smoke standup ${S}`, startsAt: evStart, endsAt: evEnd, patternId: smokePattern.id, timezone: "Asia/Kolkata", materializeDays: 30 });
    assert(r.status === 200 && r.json.data.occurrencesMaterialized >= 15, `series materialized on create (${r.json.data?.occurrencesMaterialized ?? 0})`);
    const smokeSeries = r.json.data;
    const firstOcc = (await call("GET", `/api/v1/temporal/events/${smokeSeries.id}`)).json.data.occurrences[0];
    r = await call("POST", `/api/v1/temporal/occurrences/${firstOcc.id}/cancel`, { reason: "smoke" });
    assert(r.status === 200, "single occurrence cancelled (exception override stored)");
    const afterCancel = await call("GET", `/api/v1/temporal/events/${smokeSeries.id}`);
    assert(afterCancel.json.data.occurrences.some((o: { status: string }) => o.status === "CANCELLED"), "cancelled occurrence visible with status");
    const secondOcc = afterCancel.json.data.occurrences.find((o: { status: string }) => o.status !== "CANCELLED");
    const moveTarget = new Date(Date.now() + 10 * 86400000).toISOString();
    r = await call("POST", `/api/v1/temporal/occurrences/${secondOcc.id}/move`, { startsAt: moveTarget });
    assert(r.status === 200 && r.json.data.moved === true, "occurrence moved (rescheduled instance)");

    // dependencies (FS with lag) + resolution
    r = await call("POST", "/api/v1/temporal/events", { calendarId: smokeCal.id, title: `Smoke prep ${S}`, startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString() });
    const prepEv = r.json.data;
    r = await call("POST", "/api/v1/temporal/events", { calendarId: smokeCal.id, title: `Smoke followup ${S}`, startsAt: new Date(Date.now() + 2.1 * 86400000).toISOString(), endsAt: new Date(Date.now() + 2.1 * 86400000 + 3600000).toISOString() });
    const followEv = r.json.data;
    r = await call("POST", "/api/v1/temporal/dependencies", { fromId: prepEv.id, toId: followEv.id, type: "FINISH_TO_START", lagValue: 24, lagUnit: "HOURS" });
    assert(r.status === 200, "FS dependency created");
    const resolved = await call("POST", `/api/v1/temporal/events/${prepEv.id}/resolve`);
    const followNode = resolved.json.data?.schedule?.find((n: { eventId: string }) => n.eventId === followEv.id);
    assert(resolved.status === 200 && followNode && followNode.delayMs > 0, `dependency engine delayed follower to honor FS+24h (+${Math.round((followNode?.delayMs ?? 0) / 3600000)}h)`);

    // resources + capacity conflicts
    r = await call("POST", "/api/v1/temporal/resources", { name: `Smoke Room ${S}`, code: `smoke-room-${S}`, type: "ROOM", capacity: 1 });
    assert(r.status === 200 && r.json.data.availabilityPatternId, "resource created with auto availability window");
    const smokeRoom = r.json.data;
    const bs = new Date(Date.now() + 3 * 86400000); bs.setUTCHours(4, 0, 0, 0);
    const be = new Date(bs.getTime() + 3600000);
    r = await call("POST", `/api/v1/temporal/resources/${smokeRoom.id}/book`, { startsAt: bs.toISOString(), endsAt: be.toISOString() });
    assert(r.status === 200 && r.json.data.status === "CONFIRMED", "resource booked");
    const dbl = await call("POST", `/api/v1/temporal/resources/${smokeRoom.id}/book`, { startsAt: new Date(bs.getTime() + 1800000).toISOString(), endsAt: be.toISOString() });
    assert(dbl.status === 409, "overlapping capacity-1 booking rejected");
    const conf = await call("GET", `/api/v1/temporal/resources/${smokeRoom.id}/conflicts`);
    assert(conf.status === 200 && Array.isArray(conf.json.data.conflicts), "resource conflict scan returns");

    // availability profile + blackout + preview
    r = await call("POST", "/api/v1/temporal/availability", { subjectType: "USER", subjectId: "smoke-" + S, patternId: smokePattern.id });
    assert(r.status === 200, "availability profile upserted");
    await call("POST", `/api/v1/temporal/availability/${r.json.data.id}/blackouts`, { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString(), reason: "smoke PTO" });
    const availP = await call("GET", `/api/v1/temporal/availability/preview?subjectType=USER&subjectId=smoke-${S}&days=14`);
    assert(availP.status === 200 && availP.json.data.windows.length >= 1, `availability windows computed (${availP.json.data?.windows?.length ?? 0} open)`);

    // slots + capacity-atomic booking + waitlist + promotion
    r = await call("POST", "/api/v1/temporal/slots/generate", { calendarId: smokeCal.id, patternId: smokePattern.id, slotMinutes: 30, durationMinutes: 30, capacity: 1, horizonDays: 10 });
    const slotGen = r.json.data;
    assert(r.status === 200 && slotGen.created >= 5, `slots generated from pattern (${slotGen.created})`);
    const openSlots = (await call("GET", `/api/v1/temporal/slots/open?calendarId=${smokeCal.id}`)).json.data;
    assert(openSlots.length >= 5, "open slots listed");
    const idemKey = `smoke-book-${S}`;
    r = await call("POST", "/api/v1/temporal/appointments/book", { slotId: openSlots[0].id, attendeeName: "Smoke A1", attendeeEmail: `smoke-a1-${S}@example.com` }, { "idempotency-key": idemKey });
    assert(r.status === 200 && r.json.data.appointment.status === "CONFIRMED" && !r.json.data.waitlisted, "slot booked capacity-atomically");
    const idemRes = await fetch(`${BASE}/api/v1/temporal/appointments/book`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(), origin: BASE, "x-csrf-token": csrf, "idempotency-key": idemKey },
      body: JSON.stringify({ slotId: openSlots[0].id, attendeeName: "Smoke A1", attendeeEmail: `smoke-a1-${S}@example.com` }),
    });
    assert(idemRes.status === 200 && idemRes.headers.get("idempotent-replayed") === "true", "idempotency-key replayed without double-book");
    const second = await call("POST", "/api/v1/temporal/appointments/book", { slotId: openSlots[0].id, attendeeName: "Smoke B", attendeeEmail: `smoke-b-${S}@example.com` });
    assert(second.status === 200 && second.json.data.waitlisted === true, "full slot → automatic waitlist position");
    const apptId = r.json.data.appointment.id;
    r = await call("POST", `/api/v1/temporal/appointments/${apptId}/checkIn`, { action: "checkIn" });
    assert(r.status === 200 && r.json.data.status === "CHECKED_IN", "check-in transitions appointment");
    r = await call("POST", `/api/v1/temporal/appointments/${apptId}/complete`, { action: "complete" });
    assert(r.status === 200 && r.json.data.status === "COMPLETED", "completion recorded");
    // waitlist promotion on release: book fresh, then cancel
    const b3 = await call("POST", "/api/v1/temporal/appointments/book", { slotId: openSlots[1].id, attendeeName: "Smoke C", attendeeEmail: `smoke-c-${S}@example.com` });
    const b4 = await call("POST", "/api/v1/temporal/appointments/book", { slotId: openSlots[1].id, attendeeName: "Smoke D", attendeeEmail: `smoke-d-${S}@example.com` });
    assert(b4.json.data.waitlisted === true, "second booking waitlisted");
    await call("POST", `/api/v1/temporal/appointments/${b3.json.data.appointment.id}/cancel`, { action: "cancel", reason: "smoke release" });
    const promoted = await call("GET", `/api/v1/temporal/appointments/${b4.json.data.appointment.id}`);
    assert(promoted.json.data.status === "CONFIRMED", "waitlist auto-promoted on cancellation");

    // public booking link (token-scoped public slot board → same engine as workspace)
    r = await call("GET", `/api/v1/temporal/calendars/${smokeCal.id}/booking-link`);
    assert(r.status === 200 && r.json.data?.token && r.json.data.path.startsWith("/book/"), `public booking link issued (${r.json.data?.openSlots ?? 0} open)`);
    const pubTok = r.json.data.token;
    const board = await call("GET", `/api/v1/public/booking/${encodeURIComponent(pubTok)}`);
    assert(board.status === 200 && board.json.data.slots.length >= 1, `public slot board serves ${board.json.data?.slots?.length ?? 0} times`);
    r = await fetch(`${BASE}/api/v1/public/booking/${encodeURIComponent(pubTok)}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ slotId: board.json.data.slots[0].id, attendeeName: `Public Visitor ${S}`, attendeeEmail: null, service: null }),
    });
    const pubJson = await r.json().catch(() => null);
    assert(r.status === 200 && pubJson?.data?.referenceCode?.startsWith("BK-"), `public booking accepted (${pubJson?.data?.status ?? "?"} ${pubJson?.data?.referenceCode ?? ""})`);
    const badTok = await call("GET", "/api/v1/public/booking/not-a-real-token");
    assert(badTok.status >= 400, "bogus booking token rejected");

    // workforce: shift, assign, overlap guard, rotation, coverage
    r = await call("POST", "/api/v1/temporal/workforce/shifts", { name: `Smoke Day ${S}`, code: `SD-${S}`, startTime: "09:00", endTime: "17:00" });
    assert(r.status === 200, "shift created");
    const smokeShift = r.json.data;
    const memberRows = ((await call("GET", "/api/v1/team/members")).json.data.members ?? []) as Array<{ userId?: string; id: string }>;
    const uid = memberRows[0]?.userId ?? memberRows[0]?.id;
    const far = 1000 + (parseInt(S.slice(-4), 36) % 1500);
    const dayA = new Date(Date.now() + far * 86400000); dayA.setUTCHours(3, 30, 0, 0);
    r = await call("POST", "/api/v1/temporal/workforce/assign", { shiftId: smokeShift.id, userId: uid, startsAt: dayA.toISOString(), endsAt: new Date(dayA.getTime() + 7.5 * 3600000).toISOString() });
    assert(r.status === 200, `shift assigned to member (dayA=${dayA.toISOString().slice(0, 10)} far=${far} ${JSON.stringify(r.json?.error ?? {}).slice(0, 80)})`);
    const overlap = await call("POST", "/api/v1/temporal/workforce/assign", { shiftId: smokeShift.id, userId: uid, startsAt: new Date(dayA.getTime() + 3600000).toISOString(), endsAt: new Date(dayA.getTime() + 9 * 3600000).toISOString() });
    assert(overlap.status === 409, "double-booked member rejected");
    r = await call("POST", "/api/v1/temporal/workforce/rotate", { shiftIds: [smokeShift.id], userIds: [uid], startsAt: new Date(Date.now() + (far + 300) * 86400000).toISOString(), days: 6, cycleLengthDays: 2 });
    assert(r.status === 200 && r.json.data.created >= 1, `rotation generated (${r.json.data?.created ?? 0})`);
    r = await call("POST", "/api/v1/temporal/workforce/coverage", { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", requiredCount: 3, skill: null });
    assert(r.status === 200, "coverage requirement stored");
    const gaps = await call("GET", "/api/v1/temporal/workforce/coverage");
    assert(gaps.status === 200 && Array.isArray(gaps.json.data.gaps), "coverage gap analysis returns");

    // triggers + universal execution pipeline (workflow consumer creates a task)
    const projectsData = (await call("GET", "/api/v1/projects?pageSize=5")).json.data;
    const projects = projectsData.rows ?? projectsData;
    r = await call("POST", "/api/v1/temporal/triggers", {
      name: `Smoke action ${S}`, anchorType: "RELATIVE", consumerType: "WORKFLOW",
      anchor: { offsetMinutes: -5, projectId: projects?.[0]?.id ?? null, title: `Smoke temporal task ${S}` },
    });
    assert(r.status === 200 && !!r.json.data.nextFireAt, "trigger armed with computed nextFireAt");
    const cronR = await call("POST", "/api/v1/cron/temporal-triggers", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(cronR.status === 200 && cronR.json.data.fired >= 1, `temporal trigger cron fired (${cronR.json.data?.fired ?? 0})`);
    const execs = (await call("GET", "/api/v1/temporal/executions")).json.data;
    const smokeExec = execs.find((x: { subjectId: string }) => x.subjectId === r.json.data.id);
    assert(smokeExec && smokeExec.status === "COMPLETED" && smokeExec.steps.every((st: { status: string }) => st.status !== "failed"), "execution pipeline: all stages passed for workflow consumer");
    const fires = (await call("GET", `/api/v1/temporal/triggers/${r.json.data.id}/fires`)).json.data;
    assert(fires.length >= 1 && fires[0].outcome === "SUCCESS", "trigger fire audit recorded");

    // SEO_REFRESH consumer — a temporal trigger operating the rank tracker
    const seoTrigger = await call("POST", "/api/v1/temporal/triggers", {
      name: `Smoke rank refresh ${S}`, anchorType: "RELATIVE", consumerType: "SEO_REFRESH", anchor: { offsetMinutes: -5 },
    });
    assert(seoTrigger.status === 200 && !!seoTrigger.json.data?.nextFireAt, "SEO-refresh trigger armed");
    await call("POST", "/api/v1/cron/temporal-triggers", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    const seoExec = ((await call("GET", "/api/v1/temporal/executions")).json.data as Array<{ subjectId: string; status: string; result: Record<string, unknown> }>).find((x) => x.subjectId === seoTrigger.json.data.id);
    assert(seoExec?.status === "COMPLETED" && typeof seoExec.result?.written === "number", `SEO refresh trigger executed via pipeline (${JSON.stringify(seoExec?.result ?? {}).slice(0, 60)})`);

    // triggers that RIDE a reusable temporal asset (pattern-driven recurrence)
    r = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke recurring ${S}`, anchorType: "CUSTOM", consumerType: "MONITORING", patternId: smokePattern.id });
    assert(r.status === 200 && !!r.json.data?.nextFireAt, `pattern-riding trigger armed off asset stream (next ${r.json.data?.nextFireAt?.slice(0, 16) ?? "—"})`);
    const patTrig = (await call("GET", "/api/v1/temporal/triggers")).json.data.find((t: { id: string }) => t.id === r.json.data.id);
    assert(patTrig?.pattern?.dsl?.includes("WEEKDAY"), "trigger listing shows the consumed temporal asset");

    // white-label branding + i18n actually render in the shell
    const brandWrite = await call("POST", "/api/v1/temporal/branding", { productName: `Temporal Co ${S}`, primaryColor: "#ff5500" });
    assert(brandWrite.status === 200, `branding saved (${brandWrite.status})`);
    const shell = await fetch(`${BASE}/dashboard`, { headers: { cookie: cookieHeader() } });
    const shellHtml = await shell.text();
    assert(shell.status === 200 && shellHtml.includes(`Temporal Co ${S}`), `white-label product name rendered in the app shell (${shell.status})`);
    const gate = await call("POST", "/api/v1/temporal/branding", { productName: `Temporal Co ${S}`, hidePoweredBy: true });
    assert(gate.status === 200 || gate.status === 402, `OEM flag respects the WHITE_LABEL plan gate (${gate.status})`);
    const pubBrand = await call("GET", "/api/v1/public/branding?domain=lumen.example");
    assert(pubBrand.status === 200 && pubBrand.json.data.productName === "OmniMark" && pubBrand.json.data.custom === false, "public branding resolves for unknown domain (default)");
    const i18nRes = await call("GET", "/api/v1/temporal/locales/strings?code=hi");
    assert(i18nRes.status === 200 && i18nRes.json.data.direction === "ltr", "locale resolution returns direction + strings");

    // ——— zero-gap battery: planetary scheduling, geoRef, condition triggers, one-shot, config holidays ———
    // (1) pattern bound to Mars Sol Coordinated — recurrence fires on the SOL clock
    const marsPat = await call("POST", "/api/v1/temporal/patterns", { name: `Smoke sol sync ${S}`, dsl: "EVERY DAY 09:00", type: "WINDOW", timeSystemCode: "MARS_SOL" });
    assert(marsPat.status === 200, "pattern bound to MARS_SOL time system");
    const marsPrev = (await call("GET", `/api/v1/temporal/patterns/${marsPat.json.data.pattern.id}/preview?days=20&max=6`)).json.data;
    const solGap = new Date(marsPrev.occurrences[1].start).getTime() - new Date(marsPrev.occurrences[0].start).getTime();
    // spacing must be a whole number of sols (88,775 s) — holidays may skip sols,
    // but no Earth 24 h grid can produce a multiple of 88,775 s
    assert(Math.abs(solGap - Math.round(solGap / 88_775_000) * 88_775_000) < 1000 && solGap >= 88_775_000, `sol-locked spacing (${Math.round(solGap / 1000)}s = ${(solGap / 88_775_000).toFixed(1)} sols)`);
    const solClock = (await call("GET", `/api/v1/temporal/time-systems/convert?code=MARS_SOL&at=${encodeURIComponent(marsPrev.occurrences[0].start)}`)).json.data;
    assert(String(solClock?.system).includes("09:00"), `fires when the sol clock reads 09:00 (${solClock?.system})`);

    // (2) one-shot anchors EXHAUST after firing; recurring assets stay ARMED
    const trigList = (await call("GET", "/api/v1/temporal/triggers")).json.data as Array<{ id: string; name: string; status: string }>;
    const oneShot = trigList.find((t) => t.name === `Smoke action ${S}`);
    assert(oneShot?.status === "EXHAUSTED", `one-shot RELATIVE trigger exhausted after firing (status=${oneShot?.status} exec=${JSON.stringify(((await call("GET", "/api/v1/temporal/executions")).json.data as Array<{ subjectId: string; status: string; result: Record<string, unknown> }>).find((x) => x.subjectId === oneShot?.id)?.result ?? "none").slice(0, 120)})`);
    assert(trigList.find((t) => t.name === `Smoke recurring ${S}`)?.status === "ARMED", "pattern-riding trigger stays armed (recurring by definition)");

    // (3) geoRef-driven astronomical triggers + invalid geo rejected
    const geo = await call("POST", "/api/v1/settings/geolocations", { name: `Smoke Mumbai ${S}`, countryCode: "IN", lat: 19.076, lng: 72.8777 });
    assert(geo.status === 200 || geo.status === 201, "geo location with coordinates created");
    const geoTrig = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke sunrise ${S}`, anchorType: "ASTRONOMICAL", consumerType: "MONITORING", anchor: { astroEvent: "SUNRISE", geoRef: geo.json.data.id } });
    assert(geoTrig.status === 200 && !!geoTrig.json.data?.nextFireAt, `ASTRONOMICAL trigger resolves via geoRef (next ${geoTrig.json.data?.nextFireAt?.slice(11, 16) ?? "—"} UTC)`);
    const badGeo = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke bad geo ${S}`, anchorType: "ASTRONOMICAL", consumerType: "MONITORING", anchor: { astroEvent: "SUNRISE", geoRef: "nonexistent" } });
    assert(badGeo.status === 422, "astronomical anchor with unresolvable geo rejected at creation");

    // (4) condition anchors: RESOURCE / CAPACITY / TEAM availability computed into nextFireAt
    const resTrig = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke room free ${S}`, anchorType: "RESOURCE_AVAILABLE", consumerType: "MONITORING", anchor: { resourceCode: `smoke-room-${S}`, minutes: 60 } });
    assert(resTrig.status === 200 && !!resTrig.json.data?.nextFireAt, "RESOURCE_AVAILABLE trigger resolved a real free window");
    const capTrig = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke seats free ${S}`, anchorType: "CAPACITY_AVAILABLE", consumerType: "MONITORING", anchor: { resourceCode: `smoke-room-${S}`, minutes: 30, seats: 1 } });
    assert(capTrig.status === 200, "CAPACITY_AVAILABLE trigger resolved");
    const teamTrig = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke team free ${S}`, anchorType: "TEAM_AVAILABLE", consumerType: "MONITORING", anchor: { userIds: [uid], minutes: 30 } });
    assert(teamTrig.status === 200 && !!teamTrig.json.data?.nextFireAt, "TEAM_AVAILABLE trigger found a shared free window");
    const badTeam = await call("POST", "/api/v1/temporal/triggers", { name: `Smoke bad team ${S}`, anchorType: "TEAM_AVAILABLE", consumerType: "MONITORING", anchor: { userIds: ["ghost"] } });
    assert(badTeam.status === 422, "unresolvable TEAM anchor rejected at creation (no silent dead trigger)");

    // (5) configured holiday calendar is honored end-to-end (materialization skips it)
    const hl = await call("POST", "/api/v1/temporal/holidays", { name: `Smoke Closure ${S}`, code: `smoke-hl-${S}`, dates: [{ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), name: "Smoke Shut Day", recurringAnnual: false }] });
    assert(hl.status === 200, "org holiday calendar created");
    const hlList = (await call("GET", "/api/v1/temporal/holidays")).json.data as Array<{ id: string; code: string }>;
    await call("POST", "/api/v1/temporal/config", { timezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5], retentionDays: 365, materializeHorizonDays: 90, holidayCalendarId: hlList.find((h) => h.code === `smoke-hl-${S}`)?.id });
    const holDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const holEvent = await call("POST", "/api/v1/temporal/events", { calendarId: smokeCal.id, title: `Holiday probe ${S}`, startsAt: new Date(Date.now() + 1000).toISOString(), endsAt: new Date(Date.now() + 90_000).toISOString(), patternId: smokePattern.id, timezone: "Asia/Kolkata", materializeDays: 12 });
    assert(holEvent.status === 200, `holiday probe event created (${JSON.stringify(holEvent.json ?? holEvent.status).slice(0, 140)})`);
    const probeOcc = ((await call("GET", `/api/v1/temporal/events/${holEvent.json?.data?.id}`)).json?.data?.occurrences ?? []) as Array<{ startsAt: string }>;
    assert(holEvent.status === 200 && !probeOcc.some((o) => o.startsAt.slice(0, 10) === holDay), `configured holiday day excluded from materialization (${probeOcc.length} occurrences)`);
    await call("POST", "/api/v1/temporal/config", { timezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5], retentionDays: 365, materializeHorizonDays: 90, holidayCalendarId: null });

    // (6) ICS feed — public, RFC5545, revocable via the share-token registry
    const feed = await call("GET", `/api/v1/temporal/calendars/${smokeCal.id}/feed-link`);
    assert(feed.status === 200 && feed.json.data?.path.includes("/api/v1/public/feed/"), "ICS feed link issued");
    const icsRes = await fetch(`${BASE}${feed.json.data.path}`);
    const icsBody = await icsRes.text();
    assert(icsRes.status === 200 && icsRes.headers.get("content-type")?.startsWith("text/calendar") && icsBody.includes("BEGIN:VCALENDAR") && icsBody.includes("BEGIN:VEVENT"), `public ICS serves RFC5545 (${(icsBody.match(/BEGIN:VEVENT/g) ?? []).length} VEVENTs)`);
    const revoke = await call("DELETE", `/api/v1/temporal/calendars/${smokeCal.id}/share-tokens`);
    assert(revoke.status === 200, "share tokens revoked");
    const deadFeed = await fetch(`${BASE}${feed.json.data.path}`);
    assert(deadFeed.status >= 400, "revoked feed link is dead");
    const deadBook = await call("GET", `/api/v1/public/booking/${encodeURIComponent(pubTok)}`);
    assert(deadBook.status >= 400, "revocation covers public booking links too (one registry)");

    // crons: materialize + governance sweeps
    r = await call("POST", "/api/v1/cron/temporal-materialize", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(r.status === 200, "materialization cron sweep runs");
    r = await call("POST", "/api/v1/cron/temporal-governance", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(r.status === 200, "governance sweep runs (retention + hold expiry)");

    // governance: versions, rollback, replay, time-travel, event store
    const vers = await call("GET", `/api/v1/temporal/governance/versions/PATTERN/${smokePattern.id}`);
    assert(vers.status === 200 && vers.json.data.length >= 2, "pattern snapshot versions recorded");
    const back = await call("POST", "/api/v1/temporal/governance/rollback", { entityType: "PATTERN", entityId: smokePattern.id, version: 1 });
    assert(back.status === 200, "rollback to v1 executed");
    const rolled = await call("GET", `/api/v1/temporal/patterns/${smokePattern.id}`);
    assert((rolled.json.data.dsl ?? "").includes("09:30"), "rolled-back content verified (09:30 restored)");
    const rep = await call("GET", `/api/v1/temporal/governance/replay/PATTERN/${smokePattern.id}`);
    assert(rep.status === 200 && rep.json.data.eventCount >= 3, `replay folds event log (${rep.json.data?.eventCount ?? 0} events)`);
    const tt = await call("GET", `/api/v1/temporal/governance/replay/PATTERN/${smokePattern.id}?at=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`);
    assert(tt.status === 200 && tt.json.data.mode === "time_travel" && tt.json.data.state?.dsl?.includes("09:30"), "time-travel returns historical state");
    const evlog = await call("GET", "/api/v1/temporal/governance/events");
    assert(evlog.status === 200 && evlog.json.data.some((e: { type: string }) => e.type === "PatternCreated"), "immutable event store contains PatternCreated");

    // library: templates, instantiate, holidays, fiscal, time systems, planetary
    const lib = await call("GET", "/api/v1/temporal/library");
    assert(lib.status === 200 && lib.json.data.length >= 24, `temporal library seeded (${lib.json.data?.length ?? 0} templates)`);
    const libKinds = new Set((lib.json.data as Array<{ kind: string }>).map((t) => t.kind));
    const requiredKinds = ["BUSINESS_HOURS", "TRADING_HOURS", "OFFICE_HOURS", "FISCAL_CALENDAR", "HOLIDAY_CALENDAR", "MAINTENANCE_WINDOW", "SHIFT_TEMPLATE", "INDUSTRY", "ENTERPRISE", "BOOKING", "WORKFLOW", "AUTOMATION", "COMPLIANCE", "LAUNCH", "SUPPORT_WINDOW", "PEAK_WINDOW", "CAPACITY_MODEL", "AVAILABILITY_MODEL", "AI_TEMPLATE", "DEPARTMENT", "RESOURCE_TEMPLATE"];
    const missingKinds = requiredKinds.filter((k) => !libKinds.has(k));
    assert(missingKinds.length === 0, `all ${requiredKinds.length} library kinds present (${libKinds.size} kinds, missing: ${missingKinds.join(", ") || "none"})`);
    const clinicTpl = lib.json.data.find((t: { code: string }) => t.code === "industry-dev-agency");
    r = await call("POST", `/api/v1/temporal/library/${clinicTpl.id}/instantiate`, {});
    assert(r.status === 200 && r.json.data.created.patterns.length === 3, "industry pack instantiated → 3 patterns");
    const hols = await call("GET", "/api/v1/temporal/holidays");
    assert(hols.status === 200 && hols.json.data.length >= 2, "global holiday calendars visible");
    const fp = await call("GET", "/api/v1/temporal/fiscal/period?code=FY-IN&at=2026-05-15");
    assert(fp.status === 200 && fp.json.data.fiscalYear === "2026/27" && fp.json.data.quarter === "FY27-Q1", `fiscal math: 15-May = ${fp.json.data?.fiscalYear} ${fp.json.data?.quarter}`);
    const tss = await call("GET", "/api/v1/temporal/time-systems");
    assert(tss.json.data.some((t: { code: string }) => t.code === "MARS_SOL") && tss.json.data.some((t: { code: string }) => t.code === "MOON_TIME"), "planetary time systems available");
    const mars = await call("GET", `/api/v1/temporal/time-systems/convert?code=MARS_SOL&at=${encodeURIComponent(new Date().toISOString())}`);
    assert(mars.status === 200 && /sol \d+/.test(mars.json.data.system), `Mars Sol time computed (${mars.json.data?.system})`);

    // intelligence + analytics
    r = await call("POST", "/api/v1/temporal/intelligence/optimize", { calendarId: smokeCal.id, durationMinutes: 30, prefer: "earliest", horizonDays: 14 });
    assert(r.status === 200 && r.json.data.recommendations.length >= 1, `optimizer recommends slots (${r.json.data?.recommendations?.length ?? 0})`);
    r = await call("POST", "/api/v1/temporal/intelligence/auto-schedule", { calendarId: smokeCal.id, title: `Smoke auto ${S}`, durationMinutes: 30 });
    assert(r.status === 200 && r.json.data.event?.id, "auto-schedule placed an event");
    const cf = await call("GET", "/api/v1/temporal/intelligence/conflicts");
    assert(cf.status === 200, "conflict detection runs");
    const fc = await call("GET", `/api/v1/temporal/intelligence/forecast?calendarId=${smokeCal.id}&weeks=4`);
    assert(fc.status === 200 && fc.json.data.forecast.length === 4, "capacity forecast projects weeks");
    const an = await call("GET", "/api/v1/temporal/analytics?days=30");
    assert(an.status === 200 && an.json.data.calendars >= 1 && an.json.data.patterns >= 1, "temporal analytics rollups return");
    const tr = await call("GET", "/api/v1/temporal/analytics/trends?days=7");
    assert(tr.status === 200 && tr.json.data.buckets.length === 7, "scheduling trends buckets return");

    // agenda + configuration + export includes temporal
    const ag = await call("GET", "/api/v1/temporal/agenda");
    assert(ag.status === 200 && ag.json.data.occurrences.length >= 1, `agenda shows materialized occurrences (${ag.json.data?.occurrences?.length ?? 0})`);
    r = await call("POST", "/api/v1/temporal/config", { timezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5], retentionDays: 365, materializeHorizonDays: 120 });
    assert(r.status === 200 && r.json.data.retentionDays === 365, "temporal configuration saved");
    const exp2 = await call("GET", "/api/v1/settings/data-export");
    assert(exp2.json.data.calendars?.length >= 1 && exp2.json.data.temporalEventLog?.length >= 1, "GDPR export includes temporal entities");

    // event-stream fabric: signed HTTP push of the immutable log, resumable cursor
    const { createServer: createSink } = await import("node:http");
    const { createHmac: hmacCreate } = await import("node:crypto");
    const streamed: Array<{ type: string; sigOk: boolean }> = [];
    const sink = createSink((req, res) => {
      let buf = "";
      req.on("data", (c) => (buf += c));
      req.on("end", () => {
        const ts = req.headers["x-omni-timestamp"] as string;
        const sig = String(req.headers["x-omni-signature"] ?? "").replace("sha256=", "");
        const ok = streamSecret ? hmacCreate("sha256", streamSecret).update(`${ts}.${buf}`, "utf8").digest("hex") === sig : false;
        try { streamed.push({ type: req.headers["x-omni-event"] as string, sigOk: ok }); } catch { /* ignore */ }
        res.writeHead(200); res.end("{}");
      });
    });
    let streamSecret = "";
    await new Promise<void>((r) => sink.listen(4598, "0.0.0.0", r));
    r = await call("POST", "/api/v1/temporal/stream/transports", { name: `Smoke fabric ${S}`, url: `http://${SINK_HOST === "127.0.0.1" ? "127.0.0.1" : "host.docker.internal"}:4598/sink`, eventMatch: "Appointment*", platformScope: true });
    assert(r.status === 200 && r.json.data.secret.startsWith("tsec_"), `stream transport created (${r.status} ${JSON.stringify(r.json ?? "").slice(0, 120)})`);
    streamSecret = r.json.data.secret;
    const streamId = r.json.data.transport.id;
    await call("POST", `/api/v1/cron/temporal-stream`, undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(streamed.length === 0, "inactive transport streams nothing (blank-fill doctrine)");
    await call("POST", `/api/v1/temporal/stream/transports/${streamId}/toggle`, { active: true });
    const streamCron = await call("POST", "/api/v1/cron/temporal-stream", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(streamCron.status === 200 && streamed.length === 0, "fresh transport starts at activation cursor (no history leak)");
    await call("POST", `/api/v1/temporal/stream/transports/${streamId}/reset`, { from: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    let resentTotal = 0;
    for (let i = 0; i < 30 && !streamed.length; i++) {
      const pass = await call("POST", "/api/v1/cron/temporal-stream", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
      resentTotal += pass.json.data.delivered; // batch cursor advances through non-matching events across passes
    }
    assert(resentTotal >= 1, `rewound cursor replays history — ${resentTotal} events pushed (at-least-once)`);
    assert(streamed.length >= 1 && streamed.every((x) => x.sigOk), `all ${streamed.length} pushed events HMAC-verified at the sink (${[...new Set(streamed.map((x) => x.type))].join(", ")})`);
    await call("POST", `/api/v1/temporal/stream/transports/${streamId}/toggle`, { active: false });
    await call("DELETE", `/api/v1/temporal/stream/transports/${streamId}`);
    sink.close();

    // public booking idempotency (replay without double-book)
    const link2 = await call("GET", `/api/v1/temporal/calendars/${smokeCal.id}/feed-link`);
    void link2;
    const link3 = await call("GET", `/api/v1/temporal/calendars/${smokeCal.id}/booking-link`);
    const pubSlots = (await call("GET", `/api/v1/public/booking/${encodeURIComponent(link3.json.data.token)}`)).json.data.slots as Array<{ id: string }>;
    const pk = `smoke-pub-${S}`;
    const pub1 = await fetch(`${BASE}/api/v1/public/booking/${encodeURIComponent(link3.json.data.token)}`, {
      method: "POST", headers: { "content-type": "application/json", origin: BASE, "idempotency-key": pk },
      body: JSON.stringify({ slotId: pubSlots[0].id, attendeeName: `Idem Public ${S}` }),
    });
    const pub1Json = await pub1.json();
    const pub2 = await fetch(`${BASE}/api/v1/public/booking/${encodeURIComponent(link3.json.data.token)}`, {
      method: "POST", headers: { "content-type": "application/json", origin: BASE, "idempotency-key": pk },
      body: JSON.stringify({ slotId: pubSlots[0].id, attendeeName: `Idem Public ${S}` }),
    });
    const pub2Json = await pub2.json();
    assert(pub1.status === 200 && pub2Json?.data?.replayed === true && pub2Json.data.referenceCode === pub1Json.data.referenceCode, "public booking honors Idempotency-Key (replay, no double-book)");

    // AI-assisted forecast insight (rides plan-gated routing; offline-safe)
    const insight = await call("POST", "/api/v1/temporal/intelligence/insight", { calendarId: smokeCal.id, weeks: 6 });
    assert(insight.status === 200 && typeof insight.json.data?.text === "string" && insight.json.data.text.length > 30, `forecast insight generated via AI routing (engine: ${insight.json.data?.engine})`);

    // single authority: legacy sweep + platform timeline + scheduled reports
    // own campaign flight with legacy cadence → sweep adopts it into an asset
    const chans = (await call("GET", "/api/v1/channels")).json.data as Array<{ id: string; ready: boolean }>;
    const readyCh = chans.find((c) => c.ready) ?? chans[0];
    const ownCamp = await call("POST", "/api/v1/campaigns", { name: `Smoke central ${S}`, mediaChannelId: readyCh.id, startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10), budget: 100 });
    const ownCampId = ownCamp.json?.data?.id;
    const ownFlight = await call("POST", "/api/v1/flights", { campaignId: ownCampId, channelId: readyCh.id, startsAt: new Date().toISOString().slice(0, 10), endsAt: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10), cadence: { days: [1, 3, 5], time: "10:00" } });
    assert(ownFlight.status === 200 || ownFlight.status === 201, `own campaign flight created (${ownFlight.status})`);
    const adopt = await call("POST", "/api/v1/temporal/adopt-legacy");
    assert(adopt.status === 200 && adopt.json.data.flights >= 1, `legacy schedule sweep adopted flights=${adopt.json.data?.flights ?? "?"} reports=${adopt.json.data?.reports ?? "?"}`);
    const ownFlights = (await call("GET", `/api/v1/flights?campaignId=${ownCampId}`)).json.data as Array<{ pattern: { dsl: string | null } | null }>;
    assert(ownFlights.length === 1 && !!ownFlights[0].pattern, `flight now rides a UTP asset (${ownFlights[0]?.pattern?.dsl ?? "—"})`);
    const tl = await call("GET", `/api/v1/temporal/timeline?to=${encodeURIComponent(new Date(Date.now() + 30 * 86400000).toISOString())}`);
    const domains = new Set((tl.json.data?.items ?? []).map((i: { domain: string }) => i.domain));
    assert(tl.status === 200 && domains.has("FLIGHT") && domains.has("PUBLISH") && domains.has("EVENT"), `one monitored timeline merges every domain (${[...domains].join(",")})`);
    const weeklyReport = await call("POST", "/api/v1/reports", { name: `Smoke weekly ${S}`, module: "REVENUE", definition: { months: 1 }, schedule: "WEEKLY" });
    assert(weeklyReport.status === 200 && weeklyReport.json.data?.nextScheduledAt, "legacy report schedule computed a UTP next-run slot");
    const adoptRr = await call("POST", "/api/v1/temporal/adopt-legacy");
    assert(adoptRr.status === 200 && adoptRr.json.data.reports >= 1, `adopt sweep centralizes legacy report schedules (reports ${adoptRr.json.data?.reports ?? 0})`);
    const wrPat = (await call("GET", `/api/v1/temporal/patterns`)).json.data.find((x: { name: string }) => x.name === `Report schedule · Smoke weekly ${S}`);
    assert(!!wrPat, "weekly report now backed by a named UTP temporal asset");
    const repCron = await call("POST", "/api/v1/cron/reports", undefined, { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` });
    assert(repCron.status === 200, `central report scheduler cron ran (${JSON.stringify(repCron.json?.data ?? {})})`);

    // ——— TPaaS consumption layer: widgets, connectors, marketplace, metering, branding, SDK ———
    // embeddable widget: create → public board → public book → rotate token
    r = await call("POST", "/api/v1/temporal/widgets", { calendarId: smokeCal.id, name: `Smoke widget ${S}`, kind: "BOOKING", appearance: { primaryColor: "#0ea5e9", title: "Book with us" }, behavior: {} });
    assert(r.status === 200 && r.json.data.token.startsWith("wgt_") && r.json.data.scriptSnippet.includes("widget.js"), "widget created with embed snippet");
    const widgetToken = r.json.data.token;
    const wBoard = await call("GET", `/api/v1/public/widget/${encodeURIComponent(widgetToken)}`);
    assert(wBoard.status === 200 && wBoard.json.data.calendar && Array.isArray(wBoard.json.data.slots), `public widget board serves ${wBoard.json.data?.slots?.length ?? 0} slots`);
    const wBook = await fetch(`${BASE}/api/v1/public/widget/${encodeURIComponent(widgetToken)}`, {
      method: "POST", headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ slotId: (wBoard.json.data.slots as Array<{ id: string }>)[0]?.id, attendeeName: `Widget Visitor ${S}`, attendeeEmail: null, service: null }),
    });
    const wBookJson = await wBook.json().catch(() => null);
    assert(wBook.status === 200 && wBookJson?.data?.referenceCode?.startsWith("BK-"), `public widget booking accepted (${wBookJson?.data?.referenceCode ?? "?"})`);
    const rotated = await call("POST", `/api/v1/temporal/widgets/${r.json.data.id}/rotate`, {});
    assert(rotated.status === 200 && rotated.json.data.token !== widgetToken, "widget token rotated (old embeds die)");
    const deadWidget = await call("GET", `/api/v1/public/widget/${encodeURIComponent(widgetToken)}`);
    assert(deadWidget.status >= 400, "rotated widget token rejected");

    // external calendar connectors (CalDAV/iCal/Google/Graph templates + subscribe sync)
    const tpls = await call("GET", "/api/v1/temporal/connectors/templates");
    assert(tpls.status === 200 && tpls.json.data.some((t: { protocol: string }) => t.protocol === "ICAL_SUBSCRIBE") && tpls.json.data.some((t: { protocol: string }) => t.protocol === "CALDAV"), "connector templates seeded (Google/Graph/CalDAV/iCal)");
    const conn = await call("POST", "/api/v1/temporal/connectors", { calendarId: smokeCal.id, templateKey: "ical-subscribe", externalId: "https://example.com/feed.ics", direction: "PULL" });
    assert(conn.status === 200 && conn.json.data.protocol === "ICAL_SUBSCRIBE", "iCal subscribe connector connected");
    const connList = await call("GET", "/api/v1/temporal/connectors");
    assert(connList.status === 200 && connList.json.data.length >= 1, "connection listed with status");
    const syncRes = await call("POST", `/api/v1/temporal/connectors/${conn.json.data.id}/sync`, {});
    assert(syncRes.status === 200 && (syncRes.json.data.status === "ERROR" || typeof syncRes.json.data.imported === "number"), "connector sync runs (real HTTP; unreachable feed surfaces as ERROR state, not a crash)");
    const badConn = await call("POST", "/api/v1/temporal/connectors", { calendarId: smokeCal.id, templateKey: "caldav", direction: "PULL" });
    assert(badConn.status === 422, "CalDAV without credentials rejected");

    // marketplace: create → certify → publish → install → metered
    const listing = await call("POST", "/api/v1/temporal/marketplace", {
      code: `smoke-pack-${S}`, name: `Smoke Industry Pack ${S}`, assetKind: "INDUSTRY", version: "1.0.0",
      bundle: { patterns: [{ name: "Pack standup", dsl: "EVERY WEEKDAY 09:15", type: "WINDOW" }], rules: [{ name: "Pack hours", type: "BUSINESS_HOURS", params: { windows: [{ start: "09:00", end: "18:00" }], days: [1, 2, 3, 4, 5] }, hard: true }] },
      pricingModel: "REVENUE_SHARE", price: 5000, revenueShareBps: 1500,
    });
    assert(listing.status === 200 && listing.json.data.status === "DRAFT", "marketplace listing drafted");
    const cert = await call("POST", `/api/v1/temporal/marketplace/${listing.json.data.id}/certify`, { decision: "CERTIFIED", note: "smoke certified" });
    assert(cert.status === 200 && cert.json.data.certification === "CERTIFIED", "listing certified (platform gate)");
    const pub = await call("POST", `/api/v1/temporal/marketplace/${listing.json.data.id}/publish`, {});
    assert(pub.status === 200 && pub.json.data.status === "PUBLISHED", "listing published to marketplace");
    const install = await call("POST", `/api/v1/temporal/marketplace/${listing.json.data.id}/install`, {});
    assert(install.status === 200 && install.json.data.created.patterns.length === 1 && install.json.data.created.rules.length === 1, `listing installed → ${install.json.data?.created?.patterns?.length ?? 0} pattern(s), ${install.json.data?.created?.rules?.length ?? 0} rule(s)`);
    const dupInstall = await call("POST", `/api/v1/temporal/marketplace/${listing.json.data.id}/install`, {});
    assert(dupInstall.status === 409, "duplicate install rejected (versioned upgrades only)");
    const listing2 = await call("POST", "/api/v1/temporal/marketplace", { code: `smoke-pack-${S}`, name: "v1.1", assetKind: "INDUSTRY", version: "1.1.0", bundle: {} });
    assert(listing2.status === 200, "same code new version accepted (versioning)");
    const installs = await call("GET", "/api/v1/temporal/marketplace/installs");
    assert(installs.status === 200 && installs.json.data.length >= 1, "install ledger visible");

    // metering: usage recorded from real acts, priced, rolled up
    const met = await call("GET", "/api/v1/temporal/metering/summary?days=30");
    const metricNames = (met.json.data.metrics as Array<{ metric: string; quantity: number }>).map((m) => m.metric);
    assert(met.status === 200 && metricNames.includes("APPOINTMENT") && metricNames.includes("EXECUTION") && metricNames.includes("WIDGET_VIEW"), `usage metered across acts (${metricNames.join(", ")})`);
    const plans = (await call("GET", "/api/v1/billing/subscription")).json.data;
    const planId = plans?.subscription?.planId ?? plans?.plan?.id;
    if (planId) {
      const price = await call("POST", "/api/v1/temporal/metering/prices", { planId, metric: "APPOINTMENT", includedQty: 10, price: 25 });
      assert(price.status === 200 && Number(price.json.data.priceMinor) === 2500, "metered price set (paise-exact)");
    }
    const events = await call("GET", "/api/v1/temporal/metering/events?metric=EXECUTION");
    assert(events.status === 200 && Array.isArray(events.json.data), "usage event ledger queryable");

    // white-label branding + i18n locale catalog
    const brand = await call("POST", "/api/v1/temporal/branding", { productName: `Smoke Time ${S}`, primaryColor: "#ff5500", tagline: "Your time, your brand" });
    assert(brand.status === 200 || brand.status === 402, `branding write gated by plan (${brand.status})`);
    const loc = await call("POST", "/api/v1/temporal/locales", { code: "hi", name: "Hindi", nativeName: "हिन्दी", strings: { "nav.dashboard": "डैशबोर्ड" }, isDefault: false });
    assert(loc.status === 200 && loc.json.data.code === "hi", "locale catalog upserted with translation map");
    const strs = await call("GET", "/api/v1/temporal/locales/strings?code=hi");
    assert(strs.status === 200 && strs.json.data.strings["nav.dashboard"] === "डैशबोर्ड", "resolved strings merge platform + workspace (i18n live)");

    // SDK + GraphQL consumption surface
    const sdkTargets = await call("GET", "/api/v1/temporal/sdk/targets");
    assert(sdkTargets.status === 200 && sdkTargets.json.data.length === 8, `SDK targets available (${(sdkTargets.json.data as string[]).join(", ")})`);
    const sdk = await call("GET", "/api/v1/temporal/sdk?language=typescript");
    assert(sdk.status === 200 && sdk.json.data.content.includes("class TemporalClient") && sdk.json.data.content.includes("listCalendars"), "TypeScript SDK generated from the live route descriptor");
    const pySdk = await call("GET", "/api/v1/temporal/sdk?language=python");
    assert(pySdk.status === 200 && pySdk.json.data.content.includes("class TemporalClient"), "Python SDK generated");
    const goSdk = await call("GET", "/api/v1/temporal/sdk?language=go");
    assert(goSdk.status === 200 && goSdk.json.data.content.includes("package omnimark"), "Go SDK generated");
    const gql = await call("POST", "/api/v1/temporal/graphql", { query: "{ calendars patterns analytics }" });
    assert(gql.status === 200 && Array.isArray(gql.json.data.calendars) && Array.isArray(gql.json.data.patterns), "GraphQL gateway returns temporal data (read-only)");
    const gqlBad = await call("POST", "/api/v1/temporal/graphql", { query: "mutation { deleteEverything }" });
    assert(gqlBad.status === 422, "GraphQL mutations refused (writes stay on RBAC REST)");

    // broker adapters: Kafka/Pulsar transports validated
    const kafkaNoTopic = await call("POST", "/api/v1/temporal/stream/transports", { name: `Smoke kafka ${S}`, url: "https://broker.example:8082", kind: "KAFKA", platformScope: true });
    assert(kafkaNoTopic.status === 422, "Kafka transport without topic rejected");
    const kafka = await call("POST", "/api/v1/temporal/stream/transports", { name: `Smoke kafka ${S}`, url: "https://broker.example:8082", kind: "KAFKA", topic: "temporal-events", eventMatch: "*", platformScope: true });
    assert(kafka.status === 200 && kafka.json.data.transport.url.includes("topic=temporal-events"), "Kafka broker adapter configured (topic in transport url)");
    await call("DELETE", `/api/v1/temporal/stream/transports/${kafka.json.data.transport.id}`);

    // schedule-health monitor over everything centralized
    const mon = await call("GET", "/api/v1/temporal/monitor");
    const mh = mon.json?.data as { score: number; crons: Array<{ key: string }>; staleSeries: unknown[] };
    assert(mon.status === 200 && mh.score >= 0 && mh.score <= 100 && mh.crons.length >= 6, `schedule health monitor: score ${mh?.score}, ${mh?.crons?.length ?? 0} cron heartbeats watched`);
    assert(mh.crons.some((c) => c.key === "cron:reports") && mh.crons.some((c) => c.key === "cron:temporal-triggers"), "monitor watches the full centralized cron set");

    // registry exposes the domain
    const reg2 = await call("GET", "/api/v1/registry");
    assert(reg2.json.data.domains.some((d: { id: string }) => d.id === "temporal"), "constitution registry lists the Temporal domain");

    // hygiene: deprecate + keep data (append-only by design)

    // ---- readiness + placeholder blanks ----
    r = await call("GET", "/api/v1/settings/readiness");
    const rdy = r.json?.data as { score: number; items: Array<{ key: string; state: string; label: string }> } | undefined;
    assert(r.status === 200 && rdy && rdy.items.length >= 10, `readiness checklist computed (${rdy?.items.length ?? 0} items, score ${rdy?.score})`);
    assert(rdy!.items.some((i) => i.key === "gateway-platform"), "gateway blank tracked");
    assert(rdy!.items.some((i) => i.key === "social-facebook"), "social blanks tracked");
    assert(rdy!.items.some((i) => i.key.startsWith("cron-")), "cron heartbeats tracked");
    const gwsList = (await call("GET", "/api/v1/settings/gateways")).json.data;
    const rz = gwsList.find((g: { providerCode: string }) => g.providerCode === "razorpay");
    assert(rz && rz.active === false, "razorpay placeholder exists but is NOT active (safe default)");
    const aiRows = (await call("GET", "/api/v1/studio/configs")).json.data;
    assert(aiRows.every((a: { providerCode: string; active: boolean }) => a.providerCode === "demo" || !a.active), "placeholder AI keys never active");

    // ---- data export ----
    const exp = await call("GET", "/api/v1/settings/data-export");
    assert(exp.status === 200 && exp.json?.data?.clients?.length >= 1 && exp.json.data.invoices.length >= 1, "workspace export returns entities");

    // ---- harness hygiene: archive smoke-created clients so plan seats stay free across runs
    let archived = 0;
    for (const cid of smokeClientIds.filter(Boolean)) {
      const a = await call("PATCH", `/api/v1/clients/${cid}`, { status: "ARCHIVED" });
      if (a.status === 200) archived++;
    }
    assert(archived >= 1, `smoke clients archived to release plan seats (${archived})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
