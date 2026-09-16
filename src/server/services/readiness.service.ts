import { db } from "../db";
import { getEnv } from "../env";

export type ReadyItem = {
  key: string;
  label: string;
  state: "ok" | "warn" | "missing";
  detail: string;
  action?: string;
};

const DAY = 86_400_000;
const PLACEHOLDER_MARK = "REPLACE-ME";

function stale(iso: string | null | undefined, label: string): ReadyItem {
  if (!iso) {
    return { key: label, label: `Cron: ${label}`, state: "missing", detail: "never run", action: "point your scheduler at this endpoint" };
  }
  const ageH = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  const state = ageH <= 26 ? "ok" : ageH <= 72 ? "warn" : "missing";
  return { key: `cron-${label}`, label: `Cron: ${label}`, state, detail: `last ran ${ageH}h ago` };
}

/** Production-readiness: every external blank, computed live from data. */
export async function readiness(): Promise<{ score: number; items: ReadyItem[] }> {
  const env = getEnv();
  const items: ReadyItem[] = [];

  items.push({ key: "app-url", label: "Public URL", state: env.IS_PRODUCTION && !env.APP_URL.startsWith("https://") ? "warn" : "ok", detail: env.APP_URL, action: env.IS_PRODUCTION ? "set APP_URL to the https origin" : undefined });

  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  items.push({ key: "db", label: "Database", state: dbOk ? "ok" : "missing", detail: dbOk ? "connected" : "unreachable" });

  items.push({ key: "keys", label: "Encryption keyring", state: Object.keys(env.ENCRYPTION_KEYS).length > 0 ? "ok" : "missing", detail: `${Object.keys(env.ENCRYPTION_KEYS).length} key(s), active v${env.ENCRYPTION_KEY_VERSION}`, action: "rotate by adding v2 to OMNI_ENCRYPTION_KEYS" });

  items.push({ key: "smtp", label: "Transactional email (SMTP)", state: env.SMTP_URL ? "ok" : env.IS_PRODUCTION ? "warn" : "ok", detail: env.SMTP_URL ? "configured" : "unset — emails are logged, not sent", action: "set SMTP_URL + MAIL_FROM" });

  const [platformGw, orgGwLike, gateways, aiText, aiPremiumRows, socialActive, crons, plans] = await Promise.all([
    db.gatewayConfig.findFirst({ where: { scope: "PLATFORM", active: true } }),
    db.gatewayConfig.findFirst({ where: { scope: "ORGANIZATION", active: true } }),
    db.gatewayConfig.findMany({ where: { active: true, providerCode: "mock" } }),
    db.aiModelConfig.findMany({ where: { active: true, providerCode: { not: "demo" } } }),
    db.aiModelConfig.findFirst({ where: { active: true, requiredFeature: { not: null } } }),
    db.socialAppConfig.findMany({ where: { active: true } }),
    db.systemSetting.findMany({ where: { key: { in: ["cron:renew", "cron:publisher", "cron:email-dispatch", "cron:reports", "cron:temporal-triggers", "cron:temporal-materialize", "cron:temporal-governance", "cron:temporal-stream"] } } }),
    db.plan.count({ where: { status: "PUBLISHED" } }),
  ]);
  const cronMap = new Map(crons.map((c) => [c.key.replace("cron:", ""), (c.value as { at?: string })?.at]));

  items.push({
    key: "gateway-platform",
    label: "Platform payment gateway",
    state: platformGw && platformGw.providerCode !== "mock" ? "ok" : "warn",
    detail: platformGw ? `${platformGw.providerCode} (${platformGw.mode.toLowerCase()})${platformGw.providerCode === "mock" ? " — sandbox only" : ""}` : "none active",
    action: "Settings → Payments: fill Razorpay/Stripe keys + activate",
  });
  items.push({
    key: "gateway-org",
    label: "Client collection gateway",
    state: orgGwLike ? "ok" : "warn",
    detail: orgGwLike ? orgGwLike.providerCode : "no workspace has an active gateway",
    action: "each agency workspace adds its own under Settings → Payments",
  });
  items.push({
    key: "sandbox-flag",
    label: "Sandbox/mock configs in use",
    state: gateways.length > 0 || !env.IS_PRODUCTION ? "ok" : "missing",
    detail: `${gateways.length} active mock gateway config(s)${env.IS_PRODUCTION ? " — deactivate before launch" : " (fine in dev)"}`,
    action: env.IS_PRODUCTION ? "deactivate mock rows" : undefined,
  });
  items.push({
    key: "ai-providers",
    label: "AI text providers (non-demo)",
    state: aiText.length > 0 ? "ok" : "warn",
    detail: aiText.length ? aiText.map((a) => a.providerCode).join(", ") : "only the offline demo engine is active",
    action: "Settings → AI Studio: replace REPLACE-ME key, activate",
  });
  items.push({
    key: "ai-premium",
    label: "Premium AI tier (plan-gated)",
    state: aiPremiumRows ? "ok" : "warn",
    detail: aiPremiumRows ? `${aiPremiumRows.providerCode} gated on ${aiPremiumRows.requiredFeature}` : "no plan-gated provider active",
    action: "fill OpenAI/Anthropic keys → gate stays automatic",
  });
  for (const net of ["facebook", "x", "linkedin"] as const) {
    const active = socialActive.some((s) => s.connectorKey === net && !s.clientId.includes(PLACEHOLDER_MARK));
    items.push({
      key: `social-${net}`,
      label: `Social app: ${net}`,
      state: active ? "ok" : "warn",
      detail: active ? "configured" : "blank — fill client id/secret on /social",
      action: "create the app, set redirect to /api/v1/social/callback, paste keys",
    });
  }
  items.push(stale(cronMap.get("renew") ?? null, "renew"));
  items.push(stale(cronMap.get("publisher") ?? null, "publisher"));
  items.push(stale(cronMap.get("email-dispatch") ?? null, "email-dispatch"));
  items.push(stale(cronMap.get("reports") ?? null, "reports"));
  items.push(stale(cronMap.get("temporal-triggers") ?? null, "temporal-triggers"));
  items.push(stale(cronMap.get("temporal-materialize") ?? null, "temporal-materialize"));
  items.push(stale(cronMap.get("temporal-governance") ?? null, "temporal-governance"));
  items.push(stale(cronMap.get("temporal-stream") ?? null, "temporal-stream"));
  items.push({ key: "plans", label: "Published billing plans", state: plans > 0 ? "ok" : "warn", detail: `${plans} plan(s)` });

  const score = Math.round((items.filter((i) => i.state === "ok").length / items.length) * 100);
  return { score, items };
}

