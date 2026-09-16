/**
 * UTP Event-Stream Transports — the "Kafka / Pulsar / Event Fabric" layer,
 * implemented as data + a working signed HTTP-push adapter.
 *
 * The TemporalEventLog is the immutable source of truth; each transport owns
 * a resumable (at,id) cursor and at-least-once delivery with HMAC-SHA256
 * signatures, bounded retries, failure counters and auto-pause. Brokers are
 * additional adapters on TransportKind — the app contract never changes.
 */

import crypto from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { decryptSecret, encryptSecret } from "../crypto";
import { nameish } from "../schemas";
import { audit } from "./common";
import { emit } from "../events";
import type { Ctx } from "./common";

const MATCH_RE = /^[A-Za-z][A-Za-z0-9._-]{0,78}\*?$/;
const MAX_BATCH = 40;
const MAX_FAILS = 12;

function streamAad(id: string): string {
  return `stream:${id}`;
}

function matches(pattern: string, type: string): boolean {
  const p = pattern.toLowerCase();
  const t = type.toLowerCase();
  if (p === "*") return true;
  if (p.endsWith("*")) return t.startsWith(p.slice(0, -1));
  return p === t;
}

export const transportSchema = z.object({
  name: nameish,
  url: z.string().trim().url().max(500),
  eventMatch: z.string().trim().max(80).default("*"),
  platformScope: z.boolean().default(false), // org users may create workspace-scoped only
});

export async function createTransport(ctx: Ctx, input: unknown) {
  const data = transportSchema.parse(input);
  if (data.platformScope && !ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Platform fabric needs platform access");
  if (data.eventMatch !== "*" && !MATCH_RE.test(data.eventMatch)) throw new AppError(ErrorCodes.VALIDATION, 'eventMatch must be "*", an exact type ("AppointmentBooked") or a prefix ("Appointment*")');
  if (!/^https:\/\//.test(data.url) && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\//.test(data.url)) {
    throw new AppError(ErrorCodes.VALIDATION, "Sink URL must be https (http allowed for localhost testing only)");
  }
  const orgId = data.platformScope ? null : ctx.orgId;
  const dup = await db.streamTransport.findFirst({ where: { orgId, name: data.name } });
  if (dup) throw new AppError(ErrorCodes.CONFLICT, "Transport name exists");
  const secret = `tsec_${crypto.randomBytes(24).toString("base64url")}`;
  const created = await db.streamTransport.create({
    data: { orgId, name: data.name, url: data.url, eventMatch: data.eventMatch, secretEnc: encryptSecret(secret, "stream:pending"), createdById: ctx.userId, active: false },
  });
  await db.streamTransport.update({ where: { id: created.id }, data: { secretEnc: encryptSecret(secret, streamAad(created.id)) } });
  await audit(db, ctx, "transport.created", undefined, created.id, { url: data.url, scope: orgId ? "workspace" : "platform" });
  await emit(db, { type: "transport.created", aggregateType: "STREAM_TRANSPORT", aggregateId: created.id, orgId, payload: { name: data.name } });
  return { transport: { id: created.id, name: created.name, url: created.url, eventMatch: created.eventMatch, active: created.active, scope: orgId ? "workspace" : "platform" }, secret };
}

export async function listTransports(ctx: Ctx) {
  const rows = await db.streamTransport.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, url: r.url, eventMatch: r.eventMatch,
    active: r.active, failCount: r.failCount, lastError: r.lastError, lastSentAt: r.lastSentAt,
    sentCount: r.sentCount, cursorAt: r.cursorAt, scope: r.orgId ? "workspace" : "platform", createdAt: r.createdAt,
  }));
}

export async function setTransportActive(ctx: Ctx, id: string, active: boolean) {
  const t = await db.streamTransport.findFirst({ where: { id, OR: [{ orgId: ctx.orgId }, { orgId: null }] } });
  if (!t) throw new AppError(ErrorCodes.NOT_FOUND, "Transport not found");
  if (t.orgId === null && !ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Platform fabric needs platform access");
  if (active && /REPLACE-ME/.test(t.url)) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Fill the sink URL blank before activating");
  return db.streamTransport.update({ where: { id }, data: { active, failCount: active ? 0 : t.failCount, lastError: active ? null : t.lastError } });
}

export async function resetTransportCursor(ctx: Ctx, id: string, from?: string) {
  const t = await db.streamTransport.findFirst({ where: { id, OR: [{ orgId: ctx.orgId }, { orgId: null }] } });
  if (!t) throw new AppError(ErrorCodes.NOT_FOUND, "Transport not found");
  return db.streamTransport.update({
    where: { id },
    data: { cursorAt: from ? new Date(from) : new Date(0), cursorId: "", failCount: 0, lastError: null },
  });
}

export async function deleteTransport(ctx: Ctx, id: string) {
  const t = await db.streamTransport.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw new AppError(ErrorCodes.NOT_FOUND, "Transport not found");
  await db.streamTransport.delete({ where: { id } });
  await audit(db, ctx, "transport.deleted", undefined, id);
}

/** One streaming pass: advance every active transport's cursor with signed pushes. */
export async function streamTemporalEvents(now = new Date()): Promise<{ delivered: number; failed: number; transports: number; paused: number }> {
  const transports = await db.streamTransport.findMany({ where: { active: true }, take: 50 });
  let delivered = 0;
  let failed = 0;
  let paused = 0;
  for (const t of transports) {
    let secret: string;
    try {
      secret = decryptSecret(t.secretEnc, streamAad(t.id));
    } catch {
      await db.streamTransport.update({ where: { id: t.id }, data: { active: false, lastError: "secret unreadable — recreate transport" } });
      paused++;
      continue;
    }
    // at-least-once batch from the immutable log (org-scoped or federated)
    const events = await db.temporalEventLog.findMany({
      where: {
        ...(t.orgId ? { orgId: t.orgId } : {}),
        OR: [{ at: { gt: t.cursorAt } }, ...(t.cursorId ? [{ AND: [{ at: t.cursorAt }, { id: { gt: t.cursorId } }] }] : [])],
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      take: MAX_BATCH,
    });
    if (!events.length) continue;
    let sent = 0;
    let broke = false;
    for (const ev of events) {
      if (!matches(t.eventMatch, ev.type)) {
        // non-matching events still advance the cursor (order matters)
        await db.streamTransport.update({ where: { id: t.id }, data: { cursorAt: ev.at, cursorId: ev.id } });
        continue;
      }
      const body = JSON.stringify({
        id: ev.id,
        type: ev.type,
        aggregateType: ev.aggregateType,
        aggregateId: ev.aggregateId,
        orgId: ev.orgId,
        seq: ev.seq,
        payload: ev.payload,
        at: ev.at.toISOString(),
      });
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
      try {
        const res = await fetch(t.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-omni-event": ev.type,
            "x-omni-timestamp": String(ts),
            "x-omni-signature": `sha256=${sig}`,
            "x-omni-transport": t.id,
          },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await db.streamTransport.update({ where: { id: t.id }, data: { cursorAt: ev.at, cursorId: ev.id, sentCount: { increment: 1 }, lastSentAt: new Date(), failCount: 0, lastError: null } });
        delivered++;
        sent++;
      } catch (e) {
        const msg = (e instanceof Error ? e.message : "push failed").slice(0, 300);
        const nextFails = t.failCount + 1;
        const stop = nextFails >= MAX_FAILS;
        await db.streamTransport.update({ where: { id: t.id }, data: { failCount: nextFails, lastError: msg, active: !stop } });
        failed++;
        if (stop) paused++;
        broke = true;
        break; // cursor holds — retry next pass (at-least-once, no gaps)
      }
    }
    void sent;
    void broke;
  }
  await db.systemSetting.upsert({
    where: { key: "cron:temporal-stream" },
    create: { key: "cron:temporal-stream", value: { at: now.toISOString(), delivered } },
    update: { value: { at: now.toISOString(), delivered } },
  });
  return { delivered, failed, transports: transports.length, paused };
}
