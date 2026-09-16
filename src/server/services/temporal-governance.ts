/**
 * UTP Governance — immutable event store (append-only), snapshot versioning,
 * replay, time-travel and retention. Every meaningful temporal mutation calls
 * `govern()` inside its transaction so audit, compliance and reconstruction
 * are guaranteed, not best-effort.
 */

import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { VersionEntityType } from "@/generated/prisma/enums";

type Db = typeof db;

export type GovernInput = {
  orgId: string;
  actorId: string | null;
  entityType: VersionEntityType;
  entityId: string;
  event: string; // "ScheduleCreated" etc.
  snapshot?: unknown; // full post-image for versioning/replay
  payload?: Record<string, unknown>;
};

/**
 * Append an event to the immutable log AND a versioned snapshot in one shot.
 * Must be awaited inside the caller's $transaction (passes its tx client).
 */
export async function govern(tx: Prisma.TransactionClient | Db, input: GovernInput): Promise<void> {
  const seq = await tx.temporalEventLog.count({
    where: { aggregateType: input.entityType, aggregateId: input.entityId },
  });
  await tx.temporalEventLog.create({
    data: {
      orgId: input.orgId,
      aggregateType: input.entityType,
      aggregateId: input.entityId,
      seq: seq + 1,
      type: input.event,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      actorId: input.actorId,
      version: seq + 1,
    },
  });
  if (input.snapshot !== undefined) {
    await tx.temporalVersion.create({
      data: {
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        version: seq + 1,
        snapshot: input.snapshot as Prisma.InputJsonValue,
        change: input.event,
        actorId: input.actorId ?? "system",
      },
    });
  }
}

/** Time-travel: the snapshot of an aggregate as of a moment. */
export async function snapshotAt(entityType: VersionEntityType, entityId: string, at: Date, orgId: string) {
  const snap = await db.temporalVersion.findFirst({
    where: { entityType, entityId, orgId, createdAt: { lte: at } },
    orderBy: { version: "desc" },
  });
  return snap;
}

/** Replay: fold the event log forward to reconstruct aggregate state + trail. */
export async function replayAggregate(entityType: VersionEntityType, entityId: string, orgId: string, upto?: Date) {
  const events = await db.temporalEventLog.findMany({
    where: { aggregateType: entityType, aggregateId: entityId, orgId, ...(upto ? { at: { lte: upto } } : {}) },
    orderBy: { seq: "asc" },
    select: { seq: true, type: true, payload: true, at: true, actorId: true },
  });
  const versions = await db.temporalVersion.findMany({
    where: { entityType, entityId, orgId, ...(upto ? { createdAt: { lte: upto ?? new Date() } } : {}) },
    orderBy: { version: "asc" },
    select: { version: true, change: true, snapshot: true, createdAt: true },
  });
  return {
    aggregate: `${entityType}:${entityId}`,
    eventCount: events.length,
    trail: events,
    state: versions.length ? versions[versions.length - 1].snapshot : null,
    versions: versions.map((v) => ({ version: v.version, change: v.change, at: v.createdAt })),
  };
}

/**
 * Retention sweep (cron): prune event-log/version rows older than the org's
 * retentionDays. Returns how many rows were removed.
 */
export async function applyRetention(now = new Date()): Promise<{ prunedOrgs: number; prunedEvents: number; prunedVersions: number }> {
  const configs = await db.temporalConfiguration.findMany({ where: { retentionDays: { gt: 0 } }, select: { orgId: true, retentionDays: true } });
  let prunedEvents = 0;
  let prunedVersions = 0;
  for (const c of configs) {
    const cutoff = new Date(now.getTime() - c.retentionDays * 86_400_000);
    const [ev, ver] = await Promise.all([
      db.temporalEventLog.deleteMany({ where: { orgId: c.orgId, at: { lt: cutoff } } }),
      db.temporalVersion.deleteMany({ where: { orgId: c.orgId, createdAt: { lt: cutoff } } }),
    ]);
    prunedEvents += ev.count;
    prunedVersions += ver.count;
  }
  return { prunedOrgs: configs.length, prunedEvents, prunedVersions };
}

/**
 * Compute utilization for a set of bookings vs capacity over a window, using
 * merged interval math. Shared by analytics + resource + workforce services.
 */
export function utilization(boundaryMs: number, busy: Array<{ startsAt: Date; endsAt: Date }>): number {
  if (boundaryMs <= 0) return 0;
  const total = busy.reduce((acc, b) => acc + Math.max(0, b.endsAt.getTime() - b.startsAt.getTime()), 0);
  return Math.min(10000, Math.round((total / boundaryMs) * 10000)); // basis points
}
