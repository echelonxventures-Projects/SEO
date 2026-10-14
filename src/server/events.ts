import crypto from "node:crypto";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { AppError, ErrorCodes } from "./errors";
import type { Prisma } from "@/generated/prisma/client";

export type EmitInput = {
  type: string; // "domain.action"
  aggregateType: string;
  aggregateId: string;
  orgId?: string | null;
  payload?: Record<string, unknown>;
};

const TYPE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9._-]{1,60}|\.\*)$/;
const DELIVERY_MAX_ATTEMPTS = 3;
const LOOKBACK_MS = 24 * 3600_000;

/**
 * Append to the transactional outbox — call inside the SAME $transaction as
 * the state change, so events and data commit atomically. Delivery is async
 * via runEventDispatcher() (cron endpoint).
 */
export async function emit(tx: Prisma.TransactionClient | typeof db, input: EmitInput): Promise<string> {
  const base = input.type.split(".")[0] ?? "";
  if (!TYPE_RE.test(input.type) || !/^[a-z][a-z0-9-]*\./.test(input.type) || !base) {
    console.error(`[events] rejected malformed type "${input.type}"`);
    return "";
  }
  const row = await tx.domainEvent.create({
    data: {
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      orgId: input.orgId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
  return row.id;
}

function subscriptionAad(id: string): string {
  return `eventsub:${id}`;
}

function matches(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export async function createSubscription(input: { orgId: string | null; eventMatch: string; url: string; label: string }) {
  if (!/^https:\/\//.test(input.url) && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\//.test(input.url)) {
    throw new AppError(ErrorCodes.VALIDATION, "Webhook URL must be https (http allowed for localhost testing only)");
  }
  const pat = input.eventMatch;
  if (pat !== "*" && !TYPE_RE.test(pat)) {
    throw new AppError(ErrorCodes.VALIDATION, 'eventMatch must be an event type ("offer.redeemed"), a prefix ("offer.*"), or "*"');
  }
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const created = await db.eventSubscription.create({
    data: { orgId: input.orgId, eventMatch: pat, url: input.url, label: input.label, secretEnc: encryptSecret(secret, "eventsub:pending") },
  });
  await db.eventSubscription.update({
    where: { id: created.id },
    data: { secretEnc: encryptSecret(secret, subscriptionAad(created.id)) },
  });
  return { subscription: { id: created.id, eventMatch: created.eventMatch, url: created.url, label: created.label }, secret };
}

/**
 * One pass: (1) fan out undelivered recent events to matching active
 * subscriptions, (2) attempt every PENDING delivery with HMAC-signed POSTs
 * and bounded retries. Safe to run every minute.
 */
export async function runEventDispatcher(): Promise<{ created: number; delivered: number; failed: number; triggersFired: number }> {
  // 1) fan-out
  const [events, subs] = await Promise.all([
    db.domainEvent.findMany({
      where: { occurredAt: { gte: new Date(Date.now() - LOOKBACK_MS) } },
      take: 200,
      orderBy: { occurredAt: "asc" },
      include: { deliveries: { select: { subscriptionId: true } } },
    }),
    db.eventSubscription.findMany({ where: { active: true } }),
  ]);
  let created = 0;
  let firedTriggers = 0;
  for (const ev of events) {
    try {
      const { fireTriggersFor } = await import("./services/triggers.service");
      firedTriggers += await fireTriggersFor(ev);
    } catch { /* trigger errors never block delivery */ }
    const done = new Set(ev.deliveries.map((x) => x.subscriptionId));
    for (const s of subs) {
      if (done.has(s.id) || !matches(s.eventMatch, ev.type)) continue;
      if (s.orgId !== null && s.orgId !== ev.orgId) continue; // platform subs (orgId null) federate everything
      await db.eventDelivery
        .create({ data: { eventId: ev.id, subscriptionId: s.id, status: "PENDING" } })
        .then(() => { created++; })
        .catch(() => undefined);
    }
  }

  // 2) deliver — purge work owned by deactivated subscriptions, then only
  // attempt pending deliveries for ACTIVE subscriptions (no stale backlog can
  // starve live subscribers).
  // Orchestrator projection: consume the domains it orchestrates. Runs after
  // fan-out and never blocks delivery.
  try {
    const { reconcileCampaignProjections } = await import("./services/orchestrator-consumer.service");
    await reconcileCampaignProjections(events);
  } catch { /* projection errors never block delivery */ }
  await db.eventDelivery.updateMany({
    where: { status: "PENDING", subscription: { active: false } },
    data: { status: "FAILED", error: "subscription deactivated" },
  });
  let delivered = 0;
  let failed = 0;
  const pending = await db.eventDelivery.findMany({
    where: { status: "PENDING", attempts: { lt: DELIVERY_MAX_ATTEMPTS }, subscription: { active: true } },
    take: 30,
    include: { subscription: true, event: true },
    orderBy: { at: "asc" },
  });
  for (const d of pending) {
    // atomic claim so concurrent dispatchers never double-send
    const claim = await db.eventDelivery.updateMany({
      where: { id: d.id, status: "PENDING", attempts: d.attempts },
      data: { attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;
    try {
      const secret = decryptSecret(d.subscription.secretEnc, subscriptionAad(d.subscription.id));
      const body = JSON.stringify({
        id: d.event.id,
        type: d.event.type,
        aggregateType: d.event.aggregateType,
        aggregateId: d.event.aggregateId,
        orgId: d.event.orgId,
        payload: d.event.payload,
        occurredAt: d.event.occurredAt.toISOString(),
      });
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
      const res = await fetch(d.subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-omni-event": d.event.type,
          "x-omni-timestamp": String(ts),
          "x-omni-signature": `sha256=${sig}`,
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await db.eventDelivery.update({ where: { id: d.id }, data: { status: "SENT", responseCode: res.status, error: null } });
        await db.eventSubscription.update({ where: { id: d.subscriptionId }, data: { failCount: 0, lastError: null } });
        delivered++;
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "delivery failed").slice(0, 300);
      const exhausted = d.attempts + 1 >= DELIVERY_MAX_ATTEMPTS;
      await db.eventDelivery.update({
        where: { id: d.id },
        data: { status: exhausted ? "FAILED" : "PENDING", error: msg },
      });
      const sub = await db.eventSubscription.update({
        where: { id: d.subscriptionId },
        data: { failCount: { increment: 1 }, lastError: msg },
      });
      if (sub.failCount + 1 >= 12) {
        await db.eventSubscription.update({ where: { id: d.subscriptionId }, data: { active: false, lastError: `auto-paused after ${sub.failCount + 1} failures` } });
      }
      failed++;
    }
  }
  void firedTriggers;
  await db.systemSetting.upsert({
    where: { key: "cron:events" },
    create: { key: "cron:events", value: { at: new Date().toISOString() } },
    update: { value: { at: new Date().toISOString() } },
  });
  return { created, delivered, failed, triggersFired: firedTriggers };
}

export async function listEvents(orgId: string, prefix?: string) {
  return db.domainEvent.findMany({
    where: { orgId, ...(prefix ? { type: { startsWith: prefix.replace(/\.\*$/, ".") } } : {}) },
    orderBy: { occurredAt: "desc" },
    take: 60,
    select: { id: true, type: true, aggregateType: true, aggregateId: true, payload: true, occurredAt: true },
  });
}

export async function listSubscriptions(orgId: string) {
  const rows = await db.eventSubscription.findMany({
    where: { OR: [{ orgId }, { orgId: null }] },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    eventMatch: r.eventMatch,
    url: r.url,
    label: r.label,
    active: r.active,
    failCount: r.failCount,
    lastError: r.lastError,
    orgScoped: r.orgId !== null,
  }));
}

export async function toggleSubscription(ctxOrgId: string, id: string, active: boolean) {
  const s = await db.eventSubscription.findUnique({ where: { id } });
  if (!s) throw new AppError(ErrorCodes.NOT_FOUND, "Subscription not found");
  if (s.orgId !== null && s.orgId !== ctxOrgId) throw new AppError(ErrorCodes.NOT_FOUND, "Subscription not found");
  await db.eventSubscription.update({ where: { id }, data: { active } });
}

export async function recentDeliveries(orgId: string, subscriptionId: string) {
  const s = await db.eventSubscription.findUnique({ where: { id: subscriptionId } });
  if (!s || (s.orgId !== null && s.orgId !== orgId)) throw new AppError(ErrorCodes.NOT_FOUND, "Subscription not found");
  return db.eventDelivery.findMany({ where: { subscriptionId }, orderBy: { at: "desc" }, take: 10, include: { event: { select: { type: true } } } });
}
