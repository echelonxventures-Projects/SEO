/**
 * UTP Resource Scheduling + Availability + Workforce (shifts, rotations,
 * coverage). Resources and people are temporal assets consumed by bookings;
 * capacity is enforced against ResourceBooking rows inside transactions.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import { audit, requireOwned, assertWritable } from "./common";
import { emit } from "../events";
import { govern } from "./temporal-governance";
import type { Ctx } from "./common";
import { findConflicts, overlaps, mergeIntervals, totalMinutes } from "../temporal/constraints";
import { expandPattern } from "./temporal-frame";

// ---------------------------------------------------------------------------
// resources
// ---------------------------------------------------------------------------

export const resourceSchema = z.object({
  name: nameish,
  code: z.string().trim().max(60).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  type: z.enum(["ROOM", "EQUIPMENT", "VEHICLE", "FACILITY", "STUDIO", "MACHINE", "HUMAN", "OTHER"]).default("ROOM"),
  capacity: z.number().int().min(1).max(100000).default(1),
  location: z.string().trim().max(140).nullable().optional(),
  requiresApproval: z.boolean().default(false),
  calendarId: z.string().max(64).nullable().optional(),
  availabilityPatternId: z.string().max(64).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function createResource(ctx: Ctx, input: unknown) {
  const data = resourceSchema.parse(input);
  await assertWritable(ctx.orgId);
  const dup = await db.resource.findFirst({ where: { orgId: ctx.orgId, code: data.code } });
  if (dup) throw new AppError(ErrorCodes.CONFLICT, `Resource code "${data.code}" exists`);
  if (data.availabilityPatternId) await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.availabilityPatternId } }), "Pattern", ctx.orgId);
  const res = await db.$transaction(async (tx) => {
    const r = await tx.resource.create({
      data: {
        orgId: ctx.orgId,
        name: data.name,
        code: data.code,
        type: data.type as never,
        capacity: data.capacity,
        location: data.location ?? null,
        requiresApproval: data.requiresApproval,
        calendarId: data.calendarId ?? null,
        availabilityPatternId: data.availabilityPatternId ?? null,
        metadata: data.metadata as object,
        createdById: ctx.userId,
      },
    });
    if (!data.availabilityPatternId) {
      const pattern = await tx.temporalPattern.create({
        data: {
          orgId: ctx.orgId,
          name: `${data.name} — open hours`,
          type: "WINDOW",
          freq: "DAILY",
          spec: { freq: "DAILY", interval: 1, time: "09:00", durationMinutes: 540, byBusinessDay: true, workingDays: [1, 2, 3, 4, 5] },
          dsl: "EVERY WEEKDAY 09:00 FOR 9 HOURS",
          createdById: ctx.userId,
        },
      });
      await tx.resource.update({ where: { id: r.id }, data: { availabilityPatternId: pattern.id } });
      r.availabilityPatternId = pattern.id;
    }
    await audit(tx, ctx, "resource.created", undefined, r.id, { code: r.code });
    await emit(tx, { type: "resource.created", aggregateType: "RESOURCE", aggregateId: r.id, orgId: ctx.orgId, payload: { code: r.code } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "RESOURCE", entityId: r.id, event: "ResourceCreated", snapshot: r });
    return r;
  });
  return res;
}

export async function listResources(ctx: Ctx, params: URLSearchParams) {
  const type = params.get("type") ?? undefined;
  const rows = await db.resource.findMany({ where: { orgId: ctx.orgId, ...(type ? { type: type as never } : {}) }, orderBy: { name: "asc" } });
  const bookedIds = new Set((await db.resourceBooking.findMany({ where: { orgId: ctx.orgId, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { gte: new Date() }, endsAt: { lte: new Date(Date.now() + 86400_000) } }, select: { resourceId: true } })).map((b) => b.resourceId));
  return rows.map((r) => ({ ...r, busyNow: bookedIds.has(r.id) }));
}

export async function updateResource(ctx: Ctx, id: string, input: unknown) {
  const data = resourceSchema.partial().omit({ code: true }).parse(input);
  const res = await requireOwned(await db.resource.findUnique({ where: { id } }), "Resource", ctx.orgId);
  const updated = await db.resource.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type as never,
      capacity: data.capacity,
      location: data.location,
      requiresApproval: data.requiresApproval,
      active: (data as { active?: boolean }).active,
      availabilityPatternId: data.availabilityPatternId,
      metadata: data.metadata as object | undefined,
    },
  });
  await audit(db, ctx, "resource.updated", undefined, res.id);
  return updated;
}

export async function bookResource(ctx: Ctx, input: unknown) {
  const parsed = (await import("zod")).default.object({
    resourceId: z.string().min(1),
    startsAt: z.string().min(10),
    endsAt: z.string().min(10),
    quantity: z.number().int().min(1).max(10000).default(1),
    eventId: z.string().max(64).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  }).parse(input);
  const resource = await requireOwned(await db.resource.findUnique({ where: { id: parsed.resourceId } }), "Resource", ctx.orgId);
  if (!resource.active) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Resource inactive");
  const start = new Date(parsed.startsAt);
  const end = new Date(parsed.endsAt);
  if (end <= start) throw new AppError(ErrorCodes.VALIDATION, "End must be after start");
  return db.$transaction(async (tx) => {
    const active = await tx.resourceBooking.findMany({
      where: { resourceId: resource.id, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: end }, endsAt: { gt: start } },
      select: { id: true, quantity: true },
    });
    const used = active.reduce((a, b) => a + b.quantity, 0);
    if (used + parsed.quantity > resource.capacity) {
      throw new AppError(ErrorCodes.CONFLICT, `Capacity exceeded (${used}+${parsed.quantity}/${resource.capacity})`);
    }
    const booking = await tx.resourceBooking.create({
      data: {
        orgId: ctx.orgId,
        resourceId: resource.id,
        eventId: parsed.eventId ?? null,
        quantity: parsed.quantity,
        startsAt: start,
        endsAt: end,
        status: resource.requiresApproval ? "HELD" : "CONFIRMED",
      },
    });
    await audit(tx, ctx, "resource.booked", undefined, resource.id, { bookingId: booking.id });
    await emit(tx, { type: "resource.booked", aggregateType: "RESOURCE", aggregateId: resource.id, orgId: ctx.orgId, payload: { quantity: parsed.quantity } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "RESOURCE", entityId: resource.id, event: "ResourceBooked", payload: { bookingId: booking.id, start, end } });
    return { booking, status: booking.status };
  });
}

export async function releaseBooking(ctx: Ctx, bookingId: string) {
  const b = await db.resourceBooking.findUnique({ where: { id: bookingId } });
  if (!b || b.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Booking not found");
  if (b.status === "CANCELLED") return { already: true };
  await db.resourceBooking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
  await audit(db, ctx, "resource.released", undefined, b.resourceId, { bookingId });
}

/** Conflict scan for a resource within a window. */
export async function resourceConflicts(ctx: Ctx, id: string, from?: string, to?: string) {
  const res = await requireOwned(await db.resource.findUnique({ where: { id } }), "Resource", ctx.orgId);
  const f = from ? new Date(from) : new Date();
  const t = to ? new Date(to) : new Date(f.getTime() + 14 * 86_400_000);
  const rows = await db.resourceBooking.findMany({
    where: { resourceId: res.id, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: t }, endsAt: { gt: f } },
    select: { id: true, startsAt: true, endsAt: true, quantity: true },
    orderBy: { startsAt: "asc" },
  });
  const items = rows.map((r) => ({ id: r.id, start: r.startsAt, end: r.endsAt }));
  const pairConflicts = findConflicts(items);
  const oversubscribed: string[] = [];
  for (const iv of items) {
    const used = items.filter((x) => overlaps(x, iv)).length;
    if (used > res.capacity && !oversubscribed.includes(iv.id)) oversubscribed.push(iv.id);
  }
  return { resourceId: id, capacity: res.capacity, conflicts: pairConflicts, oversubscribed, window: { from: f, to: t } };
}

// ---------------------------------------------------------------------------
// availability profiles & blackouts
// ---------------------------------------------------------------------------

export const availabilitySchema = z.object({
  subjectType: z.enum(["USER", "TEAM", "DEPARTMENT", "RESOURCE", "ORGANIZATION", "CAPACITY"]),
  subjectId: z.string().min(1).max(64),
  patternId: z.string().min(1),
  calendarId: z.string().max(64).nullable().optional(),
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  capacity: z.number().int().min(1).max(10000).default(1),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
});

export async function upsertAvailability(ctx: Ctx, input: unknown) {
  const data = availabilitySchema.parse(input);
  const pattern = await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
  if (pattern.freq === "NONE") throw new AppError(ErrorCodes.VALIDATION, "Availability pattern must recur");
  const existing = await db.availabilityProfile.findFirst({ where: { orgId: ctx.orgId, subjectType: data.subjectType as never, subjectId: data.subjectId, patternId: data.patternId } });
  const profile = await db.$transaction(async (tx) => {
    if (existing) {
      return tx.availabilityProfile.update({
        where: { id: existing.id },
        data: {
          calendarId: data.calendarId ?? null,
          timezone: data.timezone,
          capacity: data.capacity,
          effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
          effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
          active: true,
        },
      });
    }
    return tx.availabilityProfile.create({
      data: {
        orgId: ctx.orgId,
        calendarId: data.calendarId ?? null,
        subjectType: data.subjectType as never,
        subjectId: data.subjectId,
        patternId: data.patternId,
        timezone: data.timezone,
        capacity: data.capacity,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
        createdById: ctx.userId,
      },
    });
  });
  await audit(db, ctx, "availability.updated", undefined, profile.id, { subject: `${data.subjectType}:${data.subjectId}` });
  return profile;
}

export async function listAvailability(ctx: Ctx) {
  return db.availabilityProfile.findMany({
    where: { orgId: ctx.orgId, active: true },
    orderBy: { createdAt: "desc" },
    include: { pattern: { select: { id: true, name: true, dsl: true, timezone: true } }, blackouts: { take: 10, select: { id: true, startsAt: true, endsAt: true, reason: true } } },
  });
}

export async function deleteAvailability(ctx: Ctx, id: string) {
  const p = await requireOwned(await db.availabilityProfile.findUnique({ where: { id } }), "Availability profile", ctx.orgId);
  await db.availabilityProfile.update({ where: { id }, data: { active: false } });
  await audit(db, ctx, "availability.removed", undefined, p.id);
}

export async function addBlackout(ctx: Ctx, profileId: string, input: unknown) {
  const parsed = (await import("zod")).default.object({ startsAt: z.string().min(10), endsAt: z.string().min(10), reason: z.string().max(200).nullable().optional() }).parse(input);
  const p = await requireOwned(await db.availabilityProfile.findUnique({ where: { id: profileId } }), "Availability profile", ctx.orgId);
  const start = new Date(parsed.startsAt);
  const end = new Date(parsed.endsAt);
  if (end <= start) throw new AppError(ErrorCodes.VALIDATION, "End must be after start");
  const b = await db.blackoutWindow.create({ data: { orgId: ctx.orgId, profileId: p.id, startsAt: start, endsAt: end, reason: parsed.reason ?? null } });
  await audit(db, ctx, "blackout.added", undefined, p.id, { startsAt: start });
  await emit(db, { type: "availability.blackout", aggregateType: "AVAILABILITY", aggregateId: p.id, orgId: ctx.orgId, payload: { start, end } });
  return b;
}

/** Compute open windows for a subject over a horizon (pure engine + DB). */
export async function availabilityPreview(ctx: Ctx, subjectType: string, subjectId: string, params: URLSearchParams) {
  if (!["USER", "TEAM", "DEPARTMENT", "RESOURCE", "ORGANIZATION", "CAPACITY"].includes(subjectType)) throw new AppError(ErrorCodes.VALIDATION, "Bad subjectType");
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const days = Math.min(90, Number(params.get("days") ?? 14));
  const to = new Date(from.getTime() + days * 86_400_000);
  const profiles = await db.availabilityProfile.findMany({ where: { orgId: ctx.orgId, subjectType: subjectType as never, subjectId, active: true } });
  if (!profiles.length) return { windows: [], profiles: 0 };
  const windows: Array<{ start: Date; end: Date; profileId: string }> = [];
  for (const p of profiles) {
    const pattern = await db.temporalPattern.findUnique({ where: { id: p.patternId! } });
    if (!pattern) continue;
    const occ = await expandPattern(pattern, from, to, { max: 200 });
    const dur = (pattern.spec as { durationMinutes?: number })?.durationMinutes ?? 480;
    for (const o of occ) windows.push({ start: o.startsAt, end: new Date(o.startsAt.getTime() + dur * 60_000), profileId: p.id });
  }
  const blackouts = await db.blackoutWindow.findMany({ where: { orgId: ctx.orgId, profileId: { in: profiles.map((p) => p.id) }, startsAt: { lt: to }, endsAt: { gt: from } } });
  const open: Array<{ start: Date; end: Date }> = [];
  for (const w of windows) {
    const holes = blackouts.filter((b) => overlaps({ start: b.startsAt, end: b.endsAt }, w)).map((b) => ({ start: b.startsAt, end: b.endsAt }));
    let cur = [{ start: w.start, end: w.end }];
    for (const h of holes) {
      cur = cur.flatMap((c) => {
        const out: Array<{ start: Date; end: Date }> = [];
        if (h.start > c.start) out.push({ start: c.start, end: h.start });
        if (h.end < c.end) out.push({ start: h.end, end: c.end });
        return out;
      });
    }
    open.push(...cur);
  }
  return { windows: open.sort((a, b) => a.start.getTime() - b.start.getTime()), profiles: profiles.length };
}

// ---------------------------------------------------------------------------
// workforce: shifts, assignments, rotation generation, coverage
// ---------------------------------------------------------------------------

export const shiftSchema = z.object({
  name: nameish,
  code: z.string().trim().max(40).regex(/^[A-Za-z0-9._-]+$/),
  kind: z.enum(["FIXED", "ROTATING", "ON_CALL", "SPLIT", "FLEXIBLE"]).default("FIXED"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  crossDay: z.boolean().default(false),
  breakMinutes: z.number().int().min(0).max(480).default(0),
  patternId: z.string().max(64).nullable().optional(),
  color: z.string().max(16).default("#0ea5e9"),
  requiredSkills: z.array(z.string().trim().max(40)).max(20).default([]),
});

export async function createShift(ctx: Ctx, input: unknown) {
  const data = shiftSchema.parse(input);
  await assertWritable(ctx.orgId);
  const dup = await db.shift.findFirst({ where: { orgId: ctx.orgId, code: data.code } });
  if (dup) throw new AppError(ErrorCodes.CONFLICT, `Shift code exists`);
  const sh = await db.$transaction(async (tx) => {
    const s = await tx.shift.create({
      data: {
        orgId: ctx.orgId,
        name: data.name,
        code: data.code,
        kind: data.kind as never,
        startTime: data.startTime,
        endTime: data.endTime,
        crossDay: data.crossDay,
        breakMinutes: data.breakMinutes,
        patternId: data.patternId ?? null,
        color: data.color,
        requiredSkills: data.requiredSkills,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "shift.created", undefined, s.id, { code: s.code });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "RULE", entityId: s.id, event: "ShiftCreated", snapshot: s });
    return s;
  });
  return sh;
}

export async function listShifts(ctx: Ctx) {
  return db.shift.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { assignments: true } } } });
}

export const assignSchema = z.object({
  shiftId: z.string().min(1),
  userId: z.string().min(1),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10),
  role: z.enum(["PRIMARY", "SECONDARY", "BACKUP", "FLOAT"]).default("PRIMARY"),
  notes: z.string().max(500).nullable().optional(),
});

export async function assignShift(ctx: Ctx, input: unknown) {
  const data = assignSchema.parse(input);
  const shift = await requireOwned(await db.shift.findUnique({ where: { id: data.shiftId } }), "Shift", ctx.orgId);
  const user = await db.user.findFirst({ where: { id: data.userId } });
  if (!user) throw new AppError(ErrorCodes.VALIDATION, "Unknown user");
  const start = new Date(data.startsAt);
  const end = new Date(data.endsAt);
  if (end <= start) throw new AppError(ErrorCodes.VALIDATION, "End must be after start");
  // double-booking guard: same user, overlapping shift assignment
  const clash = await db.shiftAssignment.findFirst({ where: { userId: data.userId, startsAt: { lt: end }, endsAt: { gt: start } } });
  if (clash) throw new AppError(ErrorCodes.CONFLICT, "User already assigned to an overlapping shift");
  const assignment = await db.shiftAssignment.create({
    data: { orgId: ctx.orgId, shiftId: shift.id, userId: data.userId, startsAt: start, endsAt: end, role: data.role as never, notes: data.notes ?? null },
  });
  await audit(db, ctx, "shift.assigned", undefined, assignment.id, { userId: data.userId, shiftCode: shift.code });
  await emit(db, { type: "shift.assigned", aggregateType: "SHIFT_ASSIGNMENT", aggregateId: assignment.id, orgId: ctx.orgId });
  return assignment;
}

/**
 * Rotation generation: cycle users through shift sequence over N days using
 * each shift's temporal pattern (or weekly default). Deterministic.
 */
export async function generateRotation(ctx: Ctx, input: unknown) {
  const data = (await import("zod")).default.object({
    shiftIds: z.array(z.string().min(1)).min(1).max(12),
    userIds: z.array(z.string().min(1)).min(1).max(50),
    startsAt: z.string().min(10),
    days: z.number().int().min(1).max(366),
    cycleLengthDays: z.number().int().min(1).max(28).default(7),
  }).parse(input);
  const start = new Date(data.startsAt);
  if (Number.isNaN(start.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid start date");
  const shifts = await db.shift.findMany({ where: { orgId: ctx.orgId, id: { in: data.shiftIds } } });
  if (shifts.length !== data.shiftIds.length) throw new AppError(ErrorCodes.VALIDATION, "Unknown shift in rotation");
  let created = 0;
  let skipped = 0;
  await db.$transaction(async (tx) => {
    for (let day = 0; day < data.days; day++) {
      const date = new Date(start.getTime() + day * 86_400_000);
      const shift = shifts[Math.floor(day / data.cycleLengthDays) % shifts.length];
      const user = data.userIds[(Math.floor(day / data.cycleLengthDays) + shifts.indexOf(shift)) % data.userIds.length];
      const [sh, sm] = shift.startTime.split(":").map(Number);
      const [eh, em] = shift.endTime.split(":").map(Number);
      const sStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), sh, sm));
      let sEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), eh, em));
      if (shift.crossDay || sEnd <= sStart) sEnd = new Date(sEnd.getTime() + 86_400_000);
      const clash = await tx.shiftAssignment.findFirst({ where: { userId: user, startsAt: { lt: sEnd }, endsAt: { gt: sStart } } });
      if (clash) {
        skipped++;
        continue;
      }
      await tx.shiftAssignment.create({
        data: { orgId: ctx.orgId, shiftId: shift.id, userId: user, startsAt: sStart, endsAt: sEnd, role: "PRIMARY" },
      });
      created++;
    }
    await audit(tx, ctx, "shift.rotation_generated", undefined, shifts[0].id, { created, skipped, days: data.days });
    await emit(tx, { type: "shift.rotation", aggregateType: "SHIFT", aggregateId: shifts[0].id, orgId: ctx.orgId, payload: { created, skipped } });
  });
  return { created, skipped };
}

export async function coverageGaps(ctx: Ctx, params: URLSearchParams) {
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const reqs = await db.coverageRequirement.findMany({ where: { orgId: ctx.orgId } });
  const assignments = await db.shiftAssignment.findMany({ where: { orgId: ctx.orgId, startsAt: { lt: to }, endsAt: { gt: from } }, include: { shift: { select: { requiredSkills: true } } } });
  const gaps: Array<{ day: string; window: string; required: number; have: number; skill: string | null }> = [];
  for (const r of reqs) {
    for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86_400_000)) {
      if (d.getUTCDay() !== r.dayOfWeek) continue;
      const dayKey = d.toISOString().slice(0, 10);
      const [sh, sm] = r.startTime.split(":").map(Number);
      const [eh, em] = r.endTime.split(":").map(Number);
      const wStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm));
      const wEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh, em));
      const have = assignments.filter((a) => {
        if (r.skill && !a.shift.requiredSkills.includes(r.skill)) return false;
        return a.startsAt < wEnd && a.endsAt > wStart;
      }).length;
      if (have < r.requiredCount) gaps.push({ day: dayKey, window: `${r.startTime}-${r.endTime}`, required: r.requiredCount, have, skill: r.skill });
    }
  }
  return { gaps, checkedRequirements: reqs.length, window: { from, to } };
}

export const coverageSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  requiredCount: z.number().int().min(1).max(1000),
  skill: z.string().trim().max(40).nullable().optional(),
  departmentRef: z.string().max(64).nullable().optional(),
});

export async function upsertCoverageRequirement(ctx: Ctx, input: unknown) {
  const data = coverageSchema.parse(input);
  const where = { orgId: ctx.orgId, departmentRef: data.departmentRef ?? null, dayOfWeek: data.dayOfWeek, startTime: data.startTime, skill: data.skill ?? null };
  const existing = await db.coverageRequirement.findFirst({ where });
  if (existing) {
    return db.coverageRequirement.update({ where: { id: existing.id }, data: { endTime: data.endTime, requiredCount: data.requiredCount } });
  }
  return db.coverageRequirement.create({ data: { orgId: ctx.orgId, ...data, timezone: "Asia/Kolkata" } });
}

// ---------------------------------------------------------------------------
// shared analytics helpers (used by temporal-analytics service too)
// ---------------------------------------------------------------------------

export async function busyMinutes(orgId: string, resourceId: string, from: Date, to: Date): Promise<number> {
  const rows = await db.resourceBooking.findMany({ where: { orgId, resourceId, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
  const clipped = rows.map((r) => ({ start: new Date(Math.max(r.startsAt.getTime(), from.getTime())), end: new Date(Math.min(r.endsAt.getTime(), to.getTime())) }));
  return totalMinutes(mergeIntervals(clipped));
}

export async function listAssignments(ctx: Ctx, params: URLSearchParams) {
  const userId = params.get("userId") ?? undefined;
  const from = params.get("from") ? new Date(params.get("from") as string) : undefined;
  return db.shiftAssignment.findMany({
    where: { orgId: ctx.orgId, ...(userId ? { userId } : {}), ...(from ? { startsAt: { gte: from } } : {}) },
    orderBy: { startsAt: "asc" },
    take: 300,
    include: { shift: { select: { name: true, code: true, startTime: true, endTime: true } } },
  });
}

export async function deleteAssignment(ctx: Ctx, id: string) {
  const a = await db.shiftAssignment.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!a) throw new AppError(ErrorCodes.NOT_FOUND, "Assignment not found");
  await db.shiftAssignment.delete({ where: { id } });
  await audit(db, ctx, "shift.assignment_removed", undefined, a.id, { userId: a.userId, startsAt: a.startsAt });
  return { deleted: true };
}
