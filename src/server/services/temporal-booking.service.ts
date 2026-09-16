/**
 * UTP Booking Domain — appointments, slot generation from temporal assets,
 * capacity-aware atomic booking, rescheduling, waitlist (promotion on
 * release), confirmation & check-in. All conflicts/capacity are enforced
 * transactionally; every state move is event-logged.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { audit, requireOwned } from "./common";
import { emit } from "../events";
import { govern } from "./temporal-governance";
import type { Ctx } from "./common";
import { expandPattern, resolveHolidaySet, resolveHolidaySets } from "./temporal-frame";
import { subtractIntervals, slotWindows, evaluateConstraints, isBlocked, type RuleLike } from "../temporal/constraints";
import { requireCalendarWrite } from "./temporal.service";
import { signToken, verifyToken } from "../tokens";
import { sha256 } from "../crypto";
import { sendMail } from "../mail";
import { registerShareToken, requireShareToken } from "./temporal-share";

export const slotGenSchema = z.object({
  calendarId: z.string().min(1),
  resourceId: z.string().max(64).nullable().optional(),
  patternId: z.string().max(64).nullable().optional(), // window pattern; falls back to calendar pattern
  slotMinutes: z.number().int().min(5).max(480).default(30),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  capacity: z.number().int().min(1).max(1000).default(1),
  horizonDays: z.number().int().min(1).max(180).default(30),
  holdMinutes: z.number().int().min(0).max(120).default(0), // 0 = no expiring holds
});

export const bookSchema = z.object({
  slotId: z.string().min(1),
  attendeeName: z.string().trim().min(1).max(120),
  attendeeEmail: z.string().trim().email().max(254).nullable().optional(),
  attendeePhone: z.string().trim().max(30).nullable().optional(),
  attendeeRefId: z.string().max(64).nullable().optional(),
  service: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  source: z.string().trim().max(40).default("workspace"),
  autoConfirm: z.boolean().default(true),
});

export const waitlistSchema = z.object({
  calendarId: z.string().min(1),
  startsAt: z.string().min(10),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  attendeeName: z.string().trim().min(1).max(120),
  attendeeEmail: z.string().trim().email().max(254).nullable().optional(),
  service: z.string().trim().max(80).nullable().optional(),
});

function referenceCode(): string {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Date.now().toString(36).slice(-5).toUpperCase();
  return `BK-${b}-${a}`;
}

async function orgRules(ctx: Ctx, calendarId: string): Promise<RuleLike[]> {
  const cfg = await db.temporalConfiguration.findUnique({ where: { orgId: ctx.orgId } });
  const rows = await db.temporalRule.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], active: true, type: { in: ["BUSINESS_HOURS", "WORKING_DAYS", "HOLIDAY"] } } });
  const picked = rows.filter((r) => !cfg?.businessRuleId || r.id === cfg.businessRuleId || r.type === "HOLIDAY" || r.isLibrary);
  return picked.map((r) => ({ id: r.id, type: r.type as RuleLike["type"], params: r.params as Record<string, unknown>, hard: r.hard, name: r.name, priority: r.priority }));
}

async function bookingConstraintCtx(orgId: string, rules: RuleLike[]) {
  const [holidays, holidaySets] = await Promise.all([resolveHolidaySet(orgId), resolveHolidaySets(orgId, rules)]);
  return { now: new Date(), holidays, holidaySets };
}

/** Generate open slots on a calendar (+optional resource) for the horizon. */
export async function generateSlots(ctx: Ctx, input: unknown) {
  const data = slotGenSchema.parse(input);
  const cal = await requireCalendarWrite(ctx, data.calendarId);
  const patternId = data.patternId ?? cal.patternId;
  if (!patternId) throw new AppError(ErrorCodes.VALIDATION, "No window pattern on calendar or request");
  const pattern = await requireOwned(await db.temporalPattern.findUnique({ where: { id: patternId } }), "Pattern", ctx.orgId);
  const specObj = pattern.spec as { durationMinutes?: number };
  const spec = specObj as never;
  const windowDurMs = specObj.durationMinutes ? specObj.durationMinutes * 60_000 : 8 * 3_600_000;

  let windows: Array<{ start: Date; end: Date }> = [];
  const from = new Date();
  const to = new Date(from.getTime() + data.horizonDays * 86_400_000);
  const occ = await expandPattern(pattern, from, to, { max: 400, holidays: await resolveHolidaySet(ctx.orgId) });
  for (const o of occ) {
    windows.push({ start: o.startsAt, end: new Date(o.startsAt.getTime() + windowDurMs) });
  }

  // resource-specific availability narrows windows further
  if (data.resourceId) {
    const resource = await requireOwned(await db.resource.findUnique({ where: { id: data.resourceId } }), "Resource", ctx.orgId);
    if (!resource.active) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Resource is inactive");
    const ap = await db.availabilityProfile.findFirst({ where: { orgId: ctx.orgId, subjectType: "RESOURCE", subjectId: resource.id, active: true } });
    if (ap?.patternId) {
      const rpat = await db.temporalPattern.findUnique({ where: { id: ap.patternId } });
      if (rpat) {
        const rocc = await expandPattern(rpat, from, to, { max: 400 });
        const rwindows = rocc.map((o) => ({ start: o.startsAt, end: new Date(o.startsAt.getTime() + windowDurMs) }));
        windows = intersect(windows, rwindows);
      }
    }
  }

  const profile = data.resourceId
    ? await db.availabilityProfile.findFirst({ where: { orgId: ctx.orgId, subjectType: "RESOURCE", subjectId: data.resourceId, active: true } })
    : null;
  const blackouts = profile
    ? await db.blackoutWindow.findMany({ where: { profileId: profile.id }, select: { startsAt: true, endsAt: true } })
    : [];

  const rules = await orgRules(ctx, data.calendarId);
  const busy = [
    ...(await busyIntervalsForCalendar(ctx.orgId, data.calendarId, from, to)),
    ...blackouts.map((b) => ({ start: b.startsAt, end: b.endsAt })),
  ];
  const open = subtractIntervals(windows, busy);
  const candidates = slotWindows(open, data.slotMinutes, data.durationMinutes, from, 600);

  let created = 0;
  let conflicts = 0;
  await db.$transaction(async (tx) => {
    for (const c of candidates) {
      if (data.resourceId) {
        const clash = await tx.resourceBooking.findFirst({
          where: { resourceId: data.resourceId, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: c.end }, endsAt: { gt: c.start } },
        });
        if (clash) {
          conflicts++;
          continue;
        }
      }
      const dup = await tx.appointmentSlot.findFirst({ where: { calendarId: data.calendarId, startsAt: c.start, ...(data.resourceId ? { resourceId: data.resourceId } : {}) } });
      if (dup) continue;
      const viols = evaluateConstraints(c, rules, await bookingConstraintCtx(ctx.orgId, rules));
      if (isBlocked(viols)) {
        conflicts++;
        continue;
      }
      await tx.appointmentSlot.create({
        data: {
          orgId: ctx.orgId,
          calendarId: data.calendarId,
          resourceId: data.resourceId ?? null,
          startsAt: c.start,
          endsAt: c.end,
          capacity: data.capacity,
          status: "OPEN",
        },
      });
      created++;
    }
    await audit(tx, ctx, "slots.generated", undefined, data.calendarId, { created, conflicts });
    if (created) await emit(tx, { type: "slots.generated", aggregateType: "CALENDAR", aggregateId: data.calendarId, orgId: ctx.orgId, payload: { created } });
  });
  return { created, skippedByRules: conflicts, window: { from, to } };
}

async function busyIntervalsForCalendar(orgId: string, calendarId: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
  const rows = await db.appointment.findMany({
    where: { orgId, calendarId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] }, startsAt: { lt: to }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true },
    take: 1000,
  });
  return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
}

function intersect(a: Array<{ start: Date; end: Date }>, b: Array<{ start: Date; end: Date }>): Array<{ start: Date; end: Date }> {
  const out: Array<{ start: Date; end: Date }> = [];
  for (const x of a) {
    for (const y of b) {
      const s = new Date(Math.max(x.start.getTime(), y.start.getTime()));
      const e = new Date(Math.min(x.end.getTime(), y.end.getTime()));
      if (s < e) out.push({ start: s, end: e });
    }
  }
  return out;
}

/** List bookable open slots (optionally per resource). */
export async function openSlots(ctx: Ctx, params: URLSearchParams) {
  const calendarId = params.get("calendarId");
  if (!calendarId) throw new AppError(ErrorCodes.VALIDATION, "calendarId is required");
  const resourceId = params.get("resourceId") ?? undefined;
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const slots = await db.appointmentSlot.findMany({
    where: {
      orgId: ctx.orgId,
      calendarId,
      ...(resourceId ? { resourceId } : {}),
      status: "OPEN",
      startsAt: { gte: from },
    },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  return slots.filter((s) => s.booked < s.capacity).map((s) => ({ ...s, remaining: s.capacity - s.booked }));
}

/** Atomic capacity-safe booking; waitlists if the slot just filled. */
export async function book(ctx: Ctx, input: unknown) {
  const data = bookSchema.parse(input);
  return db.$transaction(async (tx) => {
    const slot = await tx.appointmentSlot.findUnique({ where: { id: data.slotId }, include: { calendar: { select: { orgId: true } } } });
    if (!slot || slot.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Slot not found");
    if (slot.status === "BLOCKED" || slot.status === "EXPIRED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Slot is closed");

    const rules = await orgRules(ctx, slot.calendarId);
    const viols = evaluateConstraints({ start: slot.startsAt, end: slot.endsAt }, rules, await bookingConstraintCtx(ctx.orgId, rules));
    if (isBlocked(viols)) {
      await emit(tx, { type: "appointment.blocked", aggregateType: "APPOINTMENT", aggregateId: slot.id, orgId: ctx.orgId, payload: { reason: viols.filter((v) => v.hard).map((v) => v.message) } });
      await tx.temporalEventLog.create({
        data: { orgId: ctx.orgId, aggregateType: "APPOINTMENT", aggregateId: slot.id, seq: (await tx.temporalEventLog.count({ where: { aggregateType: "APPOINTMENT", aggregateId: slot.id } })) + 1, type: "ConstraintViolated", payload: { slotId: slot.id, violations: viols.filter((v) => v.hard).map((v) => v.message) } as object },
      });
      throw new AppError(ErrorCodes.CONFLICT, `Blocked by constraint: ${viols.filter((v) => v.hard)[0]?.message}`);
    }

    // capacity-atomic claim
    const claim = await tx.appointmentSlot.updateMany({ where: { id: slot.id, booked: { lt: slot.capacity }, status: { in: ["OPEN", "HELD"] } }, data: { booked: { increment: 1 }, status: "BOOKED" } });
    const waitlisted = claim.count === 0;
    if (waitlisted) {
      const pos = (await tx.appointment.count({ where: { orgId: ctx.orgId, calendarId: slot.calendarId, status: "WAITLISTED", startsAt: slot.startsAt } })) + 1;
      const appt = await tx.appointment.create({
        data: {
          orgId: ctx.orgId,
          calendarId: slot.calendarId,
          referenceCode: referenceCode(),
          attendeeName: data.attendeeName,
          attendeeEmail: data.attendeeEmail ?? null,
          attendeePhone: data.attendeePhone ?? null,
          attendeeRefId: data.attendeeRefId ?? null,
          service: data.service ?? null,
          status: "WAITLISTED",
          waitlistPos: pos,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          timezone: (await tx.calendar.findUnique({ where: { id: slot.calendarId }, select: { timezone: true } }))!.timezone,
          meta: { source: data.source, slotId: slot.id } as object,
          createdById: ctx.userId,
        },
      });
      await audit(tx, ctx, "appointment.waitlisted", undefined, appt.id, { slotId: slot.id, pos });
      await emit(tx, { type: "appointment.waitlisted", aggregateType: "APPOINTMENT", aggregateId: appt.id, orgId: ctx.orgId, payload: { pos } });
      await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "APPOINTMENT", entityId: appt.id, event: "AppointmentWaitlisted", snapshot: appt });
      return { appointment: appt, waitlisted: true };
    }

    const appt = await tx.appointment.create({
      data: {
        orgId: ctx.orgId,
        calendarId: slot.calendarId,
        referenceCode: referenceCode(),
        attendeeName: data.attendeeName,
        attendeeEmail: data.attendeeEmail ?? null,
        attendeePhone: data.attendeePhone ?? null,
        attendeeRefId: data.attendeeRefId ?? null,
        service: data.service ?? null,
        status: data.autoConfirm ? "CONFIRMED" : "PENDING",
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        timezone: (await tx.calendar.findUnique({ where: { id: slot.calendarId }, select: { timezone: true } }))!.timezone,
        meta: { source: data.source, notes: data.notes ?? null, slotId: slot.id } as object,
        createdById: ctx.userId,
      },
    });
    if (slot.resourceId) {
      await tx.resourceBooking.create({
        data: { orgId: ctx.orgId, resourceId: slot.resourceId, appointmentId: appt.id, startsAt: slot.startsAt, endsAt: slot.endsAt, status: "CONFIRMED" },
      });
    }
    await audit(tx, ctx, "appointment.booked", undefined, appt.id, { slotId: slot.id });
    await emit(tx, { type: "appointment.booked", aggregateType: "APPOINTMENT", aggregateId: appt.id, orgId: ctx.orgId, payload: { code: appt.referenceCode } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "APPOINTMENT", entityId: appt.id, event: "AppointmentBooked", snapshot: appt });
    return { appointment: appt, waitlisted: false };
  });
}

/** Join a waitlist without a slot (for a calendar time someone wants). */
export async function joinWaitlist(ctx: Ctx, input: unknown) {
  const data = waitlistSchema.parse(input);
  const cal = await requireCalendarWrite(ctx, data.calendarId, "VIEW");
  const start = new Date(data.startsAt);
  if (Number.isNaN(start.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid date");
  const pos = (await db.appointment.count({ where: { orgId: ctx.orgId, calendarId: data.calendarId, status: "WAITLISTED", startsAt: start } })) + 1;
  const appt = await db.appointment.create({
    data: {
      orgId: ctx.orgId,
      calendarId: data.calendarId,
      referenceCode: referenceCode(),
      attendeeName: data.attendeeName,
      attendeeEmail: data.attendeeEmail ?? null,
      service: data.service ?? null,
      status: "WAITLISTED",
      waitlistPos: pos,
      startsAt: start,
      endsAt: new Date(start.getTime() + data.durationMinutes * 60_000),
      timezone: cal.timezone,
      meta: { source: "waitlist" } as object,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "appointment.waitlisted", undefined, appt.id, { pos });
  await emit(db, { type: "appointment.waitlisted", aggregateType: "APPOINTMENT", aggregateId: appt.id, orgId: ctx.orgId, payload: { pos } });
  return appt;
}

type ApptTransition = "confirm" | "cancel" | "checkIn" | "complete" | "noShow";

export async function transitionAppointment(ctx: Ctx, id: string, action: ApptTransition, reason?: string) {
  return db.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id } });
    if (!appt || appt.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Appointment not found");
    const allowed: Record<ApptTransition, string[]> = {
      confirm: ["PENDING", "WAITLISTED"],
      cancel: ["PENDING", "CONFIRMED", "CHECKED_IN"],
      checkIn: ["CONFIRMED"],
      complete: ["CHECKED_IN", "CONFIRMED"],
      noShow: ["CONFIRMED", "CHECKED_IN"],
    };
    if (!allowed[action].includes(appt.status)) {
      throw new AppError(ErrorCodes.ILLEGAL_STATE, `Cannot ${action} a ${appt.status.toLowerCase()} appointment`);
    }
    const next: Record<ApptTransition, string> = { confirm: "CONFIRMED", cancel: "CANCELLED", checkIn: "CHECKED_IN", complete: "COMPLETED", noShow: "NO_SHOW" };
    const updated = await tx.appointment.update({
      where: { id },
      data: {
        status: next[action] as never,
        cancelReason: action === "cancel" ? reason ?? "cancelled" : undefined,
        checkInAt: action === "checkIn" ? new Date() : undefined,
        waitlistPos: action === "confirm" ? null : undefined,
      },
    });
    await audit(tx, ctx, `appointment.${action}`, undefined, id, { status: updated.status });
    await emit(tx, { type: `appointment.${action.toLowerCase()}`, aggregateType: "APPOINTMENT", aggregateId: id, orgId: ctx.orgId });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "APPOINTMENT", entityId: id, event: `Appointment${action.charAt(0).toUpperCase()}${action.slice(1)}`, snapshot: updated });

    // releases free capacity & atomically promote the waitlist
    if (action === "cancel" || action === "noShow") {
      const slotId = (appt.meta as { slotId?: string } | null)?.slotId;
      if (slotId) {
        await tx.appointmentSlot.updateMany({ where: { id: slotId, booked: { gt: 0 } }, data: { booked: { decrement: 1 } } });
        await tx.appointmentSlot.update({ where: { id: slotId }, data: { status: "OPEN" } }).catch(() => undefined);
      }
      if (appt.resourceId) await tx.resourceBooking.updateMany({ where: { appointmentId: id, status: { in: ["HELD", "CONFIRMED"] } }, data: { status: "CANCELLED" } });
      const nextInLine = await tx.appointment.findFirst({ where: { orgId: ctx.orgId, calendarId: appt.calendarId, status: "WAITLISTED", startsAt: appt.startsAt }, orderBy: { waitlistPos: "asc" } });
      if (nextInLine) {
        const freeSlot = await tx.appointmentSlot.findFirst({ where: { calendarId: appt.calendarId, startsAt: appt.startsAt, status: "OPEN", booked: { lt: 1000 } }, orderBy: { createdAt: "asc" } });
        const claimed = freeSlot
          ? await tx.appointmentSlot.updateMany({ where: { id: freeSlot.id, booked: { lt: freeSlot.capacity } }, data: { booked: { increment: 1 }, status: "BOOKED" } })
          : { count: 0 };
        if (!freeSlot || claimed.count > 0) {
          await tx.appointment.update({ where: { id: nextInLine.id }, data: { status: "CONFIRMED", waitlistPos: null, ...(freeSlot ? { meta: { ...((nextInLine.meta as object) ?? {}), slotId: freeSlot.id } } : {}) } });
          await emit(tx, { type: "appointment.promoted", aggregateType: "APPOINTMENT", aggregateId: nextInLine.id, orgId: ctx.orgId, payload: { from: id } });
          await audit(tx, ctx, "appointment.promoted", undefined, nextInLine.id, { from: id });
          if (nextInLine.attendeeEmail) {
            await sendMail({
              to: nextInLine.attendeeEmail,
              subject: "Your spot just opened — confirmed",
              text: `Good news — a cancellation freed your waitlisted slot (${nextInLine.startsAt.toISOString().replace("T", " ").slice(0, 16)} UTC). You are now CONFIRMED. Reference: ${nextInLine.referenceCode}.`,
            }).catch(() => undefined);
          }
        }
      }
    }
    return updated;
  });
}

/** Reschedule: release old slot atomically, claim new one (or search next). */
export async function reschedule(ctx: Ctx, id: string, toSlotId: string) {
  return db.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({ where: { id } });
    if (!appt || appt.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Appointment not found");
    if (!["PENDING", "CONFIRMED", "WAITLISTED"].includes(appt.status)) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only upcoming appointments can move");
    const slot = await tx.appointmentSlot.findUnique({ where: { id: toSlotId } });
    if (!slot || slot.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Target slot not found");
    const claim = await tx.appointmentSlot.updateMany({ where: { id: toSlotId, booked: { lt: slot.capacity }, status: "OPEN" }, data: { booked: { increment: 1 }, status: "BOOKED" } });
    if (!claim.count) throw new AppError(ErrorCodes.CONFLICT, "Target slot just filled");
    const oldSlotId = (appt.meta as { slotId?: string } | null)?.slotId;
    if (oldSlotId && oldSlotId !== toSlotId) {
      await tx.appointmentSlot.updateMany({ where: { id: oldSlotId, booked: { gt: 0 } }, data: { booked: { decrement: 1 } } });
      const refreshed = await tx.appointmentSlot.findUnique({ where: { id: oldSlotId } });
      if (refreshed && refreshed.booked === 0) await tx.appointmentSlot.update({ where: { id: oldSlotId }, data: { status: "OPEN" } });
    }
    const updated = await tx.appointment.update({
      where: { id },
      data: {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: "CONFIRMED",
        waitlistPos: null,
        meta: { ...((appt.meta as object) ?? {}), slotId: toSlotId, rescheduledFrom: appt.startsAt.toISOString() } as object,
      },
    });
    if (appt.resourceId) {
      await tx.resourceBooking.updateMany({ where: { appointmentId: id }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, status: "CONFIRMED" } });
    }
    await audit(tx, ctx, "appointment.rescheduled", undefined, id, { from: appt.startsAt, to: slot.startsAt });
    await emit(tx, { type: "appointment.rescheduled", aggregateType: "APPOINTMENT", aggregateId: id, orgId: ctx.orgId, payload: { from: appt.startsAt.toISOString(), to: slot.startsAt.toISOString() } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "APPOINTMENT", entityId: id, event: "AppointmentRescheduled", snapshot: updated });
    return updated;
  });
}

export async function listAppointments(ctx: Ctx, params: URLSearchParams) {
  const status = params.get("status") ?? undefined;
  const from = params.get("from") ? new Date(params.get("from") as string) : undefined;
  return db.appointment.findMany({
    where: { orgId: ctx.orgId, ...(status ? { status: status as never } : {}), ...(from ? { startsAt: { gte: from } } : {}) },
    orderBy: { startsAt: "asc" },
    take: 300,
    include: { calendar: { select: { name: true, color: true } } },
  });
}

export async function getAppointment(ctx: Ctx, id: string) {
  const appt = await requireOwned(await db.appointment.findUnique({ where: { id } }), "Appointment", ctx.orgId);
  const trail = await db.temporalEventLog.findMany({ where: { aggregateType: "APPOINTMENT", aggregateId: id }, orderBy: { seq: "asc" }, select: { seq: true, type: true, at: true } });
  return { ...appt, trail };
}

// ---------------------------------------------------------------------------
// Public booking links (token-scoped, like invoice checkout links)
// ---------------------------------------------------------------------------

export async function createBookingLink(ctx: Ctx, calendarId: string) {
  const cal = await requireCalendarWrite(ctx, calendarId);
  if (cal.archivedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Calendar is archived");
  const openCount = await db.appointmentSlot.count({ where: { calendarId, orgId: ctx.orgId, status: "OPEN", startsAt: { gte: new Date() } } });
  const token = signToken("booking_link", calendarId, 30 * 86400);
  await registerShareToken(calendarId, token);
  await audit(db, ctx, "booking.link_created", undefined, calendarId, { expires: 30 });
  await emit(db, { type: "appointment.link_created", aggregateType: "CALENDAR", aggregateId: calendarId, orgId: ctx.orgId });
  return { token, path: `/book/${token}`, openSlots: openCount, expiresInDays: 30 };
}

/** Public slot board for a booking token. */
export async function publicAgenda(token: string) {
  const decoded = await requireShareToken("booking_link", token);
  const cal = await db.calendar.findUnique({ where: { id: decoded.s }, select: { id: true, orgId: true, name: true, color: true, timezone: true, archivedAt: true } });
  if (!cal || cal.archivedAt) throw new AppError(ErrorCodes.NOT_FOUND, "Booking page not found");
  const from = new Date();
  const slots = await db.appointmentSlot.findMany({
    where: { calendarId: cal.id, status: "OPEN", startsAt: { gte: from } },
    orderBy: { startsAt: "asc" },
    take: 40,
  });
  return {
    calendar: { name: cal.name, color: cal.color, timezone: cal.timezone },
    slots: slots.filter((x) => x.booked < x.capacity).map((x) => ({ id: x.id, startsAt: x.startsAt, endsAt: x.endsAt, remaining: x.capacity - x.booked })),
  };
}

export const publicBookSchema = bookSchema.pick({ attendeeName: true, attendeeEmail: true, service: true }).extend({
  slotId: z.string().min(1),
  notes: z.string().max(2000).nullable().optional(),
});

/** Public booking — same capacity-atomic, constraint-checked engine as workspace booking. */
export async function publicBook(token: string, input: unknown, ip: string | null, idemKey?: string | null) {
  const data = publicBookSchema.parse(input);
  const decoded = await requireShareToken("booking_link", token);
  const cal = await db.calendar.findUnique({ where: { id: decoded.s }, select: { id: true, orgId: true, archivedAt: true, createdById: true } });
  if (!cal || cal.archivedAt) throw new AppError(ErrorCodes.NOT_FOUND, "Booking page not found");

  const key = idemKey?.trim() || null;
  const bodyHash = sha256(JSON.stringify(data));
  const endpoint = "POST public-booking";
  let recordId: string | null = null;
  if (key) {
    if (!/^[\w.-]{8,120}$/.test(key)) throw new AppError(ErrorCodes.VALIDATION, "Idempotency-Key must be 8-120 chars");
    const mine = await db.idempotencyRecord.findUnique({ where: { orgId_key: { orgId: cal.orgId, key } } });
    if (mine) {
      if (mine.bodyHash !== bodyHash) throw new AppError(ErrorCodes.CONFLICT, "Idempotency-Key already used with a different body");
      if (!mine.inFlight && mine.response != null) return { ...(mine.response as Record<string, unknown>), replayed: true };
      throw new AppError(ErrorCodes.CONFLICT, "A request with this Idempotency-Key is still in flight");
    }
    const rec = await db.idempotencyRecord.create({
      data: { orgId: cal.orgId, key, endpoint, bodyHash, createdBy: cal.createdById, expiresAt: new Date(Date.now() + 24 * 3600_000) },
    }).catch(() => { throw new AppError(ErrorCodes.CONFLICT, "A request with this Idempotency-Key is in flight"); });
    recordId = rec.id;
  }

  const ctx = { viewer: null as never, orgId: cal.orgId, userId: cal.createdById, ip } as Ctx;
  let out: Record<string, unknown>;
  try {
    const result = await book(ctx, { ...data, attendeePhone: null, attendeeRefId: null, autoConfirm: true, source: "public-link" });
    out = {
      referenceCode: (result.appointment as { referenceCode: string }).referenceCode,
      status: (result.appointment as { status: string }).status,
      waitlisted: result.waitlisted,
      appointmentId: (result.appointment as { id: string }).id,
    };
  } catch (e) {
    if (recordId) await db.idempotencyRecord.deleteMany({ where: { id: recordId } });
    throw e;
  }
  if (recordId) {
    await db.idempotencyRecord.update({ where: { id: recordId }, data: { inFlight: false, status: 200, response: out as object } }).catch(() => undefined);
  }
  return out;
}
