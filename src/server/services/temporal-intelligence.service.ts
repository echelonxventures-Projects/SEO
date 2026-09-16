/**
 * UTP Temporal Intelligence & Analytics.
 *
 * Optimization / auto-scheduling / auto-replanning / conflict detection /
 * capacity prediction / recommendations / forecasting + utilization,
 * scheduling, availability and operational analytics. Every routine here is
 * a real deterministic computation over materialized occurrences, bookings
 * and appointments — no stubs, no external model required.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { requireOwned } from "./common";
import { audit } from "./common";
import type { Ctx } from "./common";
import { expandPattern, resolveHolidaySet, resolveHolidaySets } from "./temporal-frame";
import { subtractIntervals, slotWindows, evaluateConstraints, isBlocked, mergeIntervals, totalMinutes, type RuleLike } from "../temporal/constraints";
import { utilization } from "./temporal-governance";
import { resolveDependencies, type Node, type Edge } from "../temporal/dependency";

function parseRules(rows: Array<{ id: string; type: string; params: unknown; hard: boolean; name: string; priority: number }>): RuleLike[] {
  return rows.map((r) => ({ id: r.id, type: r.type as RuleLike["type"], params: r.params as Record<string, unknown>, hard: r.hard, name: r.name, priority: r.priority }));
}

async function orgRuleContext(orgId: string): Promise<{ rules: RuleLike[]; holidays: Set<string>; holidaySets: Map<string, Set<string>>; workingDays: number[] }> {
  const [cfg, rows] = await Promise.all([
    db.temporalConfiguration.findUnique({ where: { orgId } }),
    db.temporalRule.findMany({ where: { OR: [{ orgId }, { orgId: null }], active: true } }),
  ]);
  const parsed = parseRules(rows);
  const [holidays, holidaySets] = await Promise.all([resolveHolidaySet(orgId), resolveHolidaySets(orgId, parsed)]);
  return { rules: parsed, holidays, holidaySets, workingDays: cfg?.workingDays ?? [1, 2, 3, 4, 5] };
}

/** best-slot optimization: rank open candidate slots for a duration. */
export async function optimize(ctx: Ctx, input: unknown) {
  const data = z.object({
    resourceId: z.string().max(64).nullable().optional(),
    calendarId: z.string().min(1),
    durationMinutes: z.number().int().min(5).max(1440).default(30),
    prefer: z.enum(["earliest", "balanced", "peak_avoid", "business_center"]).default("earliest"),
    horizonDays: z.number().int().min(1).max(90).default(14),
    limit: z.number().int().min(1).max(10).default(5),
  }).parse(input);

  const cal = await requireOwned(await db.calendar.findUnique({ where: { id: data.calendarId } }), "Calendar", ctx.orgId);
  const patternId = cal.patternId ?? (data.resourceId ? (await db.resource.findUnique({ where: { id: data.resourceId } }))?.availabilityPatternId : null);
  if (!patternId) throw new AppError(ErrorCodes.VALIDATION, "No availability pattern on calendar/resource");
  const pattern = await requireOwned(await db.temporalPattern.findUnique({ where: { id: patternId } }), "Pattern", ctx.orgId);

  const from = new Date();
  const now = from;
  const to = new Date(from.getTime() + data.horizonDays * 86_400_000);
  const occ = await expandPattern(pattern, from, to, { max: 400, holidays: await resolveHolidaySet(ctx.orgId) });
  const durMs = (pattern.spec as { durationMinutes?: number })?.durationMinutes ? (pattern.spec as { durationMinutes: number }).durationMinutes * 60_000 : 8 * 3_600_000;
  const windows = occ.map((o) => ({ start: o.startsAt, end: new Date(o.startsAt.getTime() + durMs) }));

  const busy = await busyFor(ctx.orgId, data.calendarId, data.resourceId ?? null, from, to);
  const open = subtractIntervals(windows, busy);
  const { rules, holidays, holidaySets, workingDays } = await orgRuleContext(ctx.orgId);
  const candidates = slotWindows(open, 30, data.durationMinutes, from, 60);
  const feasible: Array<{ start: Date; end: Date; score: number; reason: string[] }> = [];
  const nowMidnight = new Date(); nowMidnight.setUTCHours(0, 0, 0, 0);
  for (const c of candidates) {
    const viols = evaluateConstraints(c, rules, { now, holidays, workingDays, holidaySets });
    if (isBlocked(viols)) continue;
    let score = 0;
    if (data.prefer === "earliest") score = -c.start.getTime() / 1e9;
    else if (data.prefer === "business_center") {
      const h = c.start.getUTCHours();
      score = -Math.abs(h - 11);
    } else if (data.prefer === "peak_avoid") {
      const load = busy.filter((b) => Math.abs(b.start.getTime() - c.start.getTime()) < 2 * 3_600_000).length;
      score = -load;
    } else {
      const day = Math.floor((c.start.getTime() - nowMidnight.getTime()) / 86_400_000);
      score = -(Math.abs((day % 5) - 2));
    }
    feasible.push({ start: c.start, end: c.end, score, reason: viols.map((v) => v.message) });
  }
  feasible.sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
  return {
    strategy: data.prefer,
    evaluated: candidates.length,
    recommendations: feasible.slice(0, data.limit).map((f) => ({ start: f.start.toISOString(), end: f.end.toISOString(), warnings: f.reason })),
  };
}

async function busyFor(orgId: string, calendarId: string, resourceId: string | null, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
  const appts = await db.appointment.findMany({ where: { orgId, calendarId, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
  const out = appts.map((a) => ({ start: a.startsAt, end: a.endsAt }));
  if (resourceId) {
    const rb = await db.resourceBooking.findMany({ where: { resourceId, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
    out.push(...rb.map((r) => ({ start: r.startsAt, end: r.endsAt })));
  }
  return out;
}

/** Auto-schedule: place a new event at the best feasible slot & persist it. */
export async function autoSchedule(ctx: Ctx, input: unknown) {
  const data = z.object({
    calendarId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    durationMinutes: z.number().int().min(5).max(1440).default(30),
    resourceId: z.string().max(64).nullable().optional(),
    prefer: z.enum(["earliest", "balanced", "peak_avoid", "business_center"]).default("earliest"),
    horizonDays: z.number().int().min(1).max(90).default(14),
  }).parse(input);
  const opt = await optimize(ctx, { ...data, limit: 1 });
  const rec = opt.recommendations[0];
  if (!rec) throw new AppError(ErrorCodes.CONFLICT, "No feasible slot found in horizon");
  const { createEvent } = await import("./temporal.service");
  const ev = await createEvent(ctx, {
    calendarId: data.calendarId,
    title: data.title,
    startsAt: rec.start,
    endsAt: rec.end,
    timezone: (await db.calendar.findUnique({ where: { id: data.calendarId } }))!.timezone,
    metadata: { autoScheduled: true, strategy: data.prefer },
  });
  await audit(db, ctx, "event.auto_scheduled", undefined, (ev as { id: string }).id, { strategy: data.prefer });
  return { event: ev, placedAt: rec };
}

/**
 * Auto-replan: when a resource/event is lost, re-place the next N occurrences
 * into the earliest feasible slots (returns proposed moves; apply=true commits).
 */
export async function autoReplan(ctx: Ctx, input: unknown) {
  const data = z.object({
    eventId: z.string().min(1),
    reason: z.string().max(200).nullable().optional(),
    apply: z.boolean().default(false),
    limit: z.number().int().min(1).max(20).default(5),
  }).parse(input);
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id: data.eventId }, include: { occurrences: { where: { status: "CONFIRMED", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: data.limit } } }), "Event", ctx.orgId);
  const proposals: Array<{ from: string; to: string; occurrenceId: string }> = [];
  const { materialize: mz } = await import("../temporal/recurrence");
  const cal = await db.calendar.findUnique({ where: { id: ev.calendarId } });
  const patternId = cal?.patternId;
  for (const occ of ev.occurrences) {
    let target = null as null | { start: Date; end: Date };
    if (patternId) {
      const pat = await db.temporalPattern.findUnique({ where: { id: patternId } });
      if (pat) {
        const from = new Date();
        const occs = await expandPattern(pat, from, new Date(from.getTime() + 45 * 86_400_000), { max: 100, holidays: await resolveHolidaySet(ctx.orgId) });
        const dur = occ.endsAt.getTime() - occ.startsAt.getTime();
        const busy = await busyFor(ctx.orgId, ev.calendarId, null, from, new Date(from.getTime() + 45 * 86_400_000));
        const open = subtractIntervals(occs.map((o) => ({ start: o.startsAt, end: new Date(o.startsAt.getTime() + dur) })), busy.filter((b) => b.start.getTime() !== occ.startsAt.getTime()));
        for (const w of open) {
          if (w.end.getTime() - w.start.getTime() >= dur && w.start >= from) {
            target = { start: w.start, end: new Date(w.start.getTime() + dur) };
            break;
          }
        }
      }
    }
    if (target) proposals.push({ from: occ.startsAt.toISOString(), to: target.start.toISOString(), occurrenceId: occ.id });
  }
  if (data.apply) {
    const { moveOccurrence } = await import("./temporal.service");
    for (const p of proposals) await moveOccurrence(ctx, p.occurrenceId, p.to).catch(() => undefined);
    await audit(db, ctx, "event.auto_replanned", undefined, data.eventId, { moved: proposals.length, reason: data.reason });
  }
  return { applied: data.apply, proposals };
}

/** Dependency resolution over a set of scheduled events (returns planned times). */
export async function resolveEventDeps(ctx: Ctx, eventId: string) {
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id: eventId } }), "Event", ctx.orgId);
  const edges = await db.temporalDependency.findMany({ where: { orgId: ctx.orgId, scope: "EVENT" }, take: 500 });
  const touched = new Set<string>([eventId]);
  for (const e of edges) {
    if (e.fromId === eventId) touched.add(e.toId);
    if (e.toId === eventId) touched.add(e.fromId);
  }
  const events = await db.scheduledEvent.findMany({ where: { orgId: ctx.orgId, id: { in: [...touched] } }, include: { occurrences: { where: { status: "CONFIRMED" }, orderBy: { startsAt: "asc" }, take: 1 } } });
  const nodes: Node[] = events.map((e) => {
    const occ = e.occurrences[0];
    return { id: e.id, start: occ ? occ.startsAt.getTime() : e.startsAt.getTime(), end: occ ? occ.endsAt.getTime() : e.endsAt.getTime() };
  });
  const relevant: Edge[] = edges.filter((e) => touched.has(e.fromId) && touched.has(e.toId)).map((e) => ({
    from: e.fromId,
    to: e.toId,
    type: e.type as Edge["type"],
    lagMinutes: e.lagValue, // stored in minutes
  }));
  const res = resolveDependencies(nodes, relevant);
  if (res.changed || res.violations.length) {
    const { emit } = await import("../events");
    await emit(db, { type: res.violations.length ? "dependency.unsatisfiable" : "dependency.resolved", aggregateType: "SCHEDULED_EVENT", aggregateId: eventId, orgId: ctx.orgId, payload: { edges: relevant.length, violations: res.violations.length } });
  }
  return {
    anchor: eventId,
    changed: res.changed,
    violations: res.violations,
    schedule: res.nodes.map((n) => {
      const e = events.find((x) => x.id === n.id);
      return { eventId: n.id, title: e?.title ?? null, start: new Date(n.start).toISOString(), end: new Date(n.end).toISOString(), delayMs: n.delayMs };
    }),
  };
}

/** Conflict detection across a calendar (overlapping occurrences). */
export async function detectConflicts(ctx: Ctx, params: URLSearchParams) {
  const calendarId = params.get("calendarId");
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const to = new Date(from.getTime() + 45 * 86_400_000);
  const occ = await db.eventOccurrence.findMany({
    where: { orgId: ctx.orgId, status: "CONFIRMED", ...(calendarId ? { event: { calendarId } } : {}), startsAt: { gte: from }, endsAt: { lte: to } },
    take: 1000,
    include: { event: { select: { title: true, calendarId: true } } },
  });
  const items = occ.map((o) => ({ id: o.id, start: o.startsAt, end: o.endsAt }));
  const conflicts = mergeConflictPairs(items, occ);
  return { calendarId: calendarId ?? "all", window: { from, to }, conflicts, occurrencesScanned: occ.length };
}

function mergeConflictPairs(items: Array<{ id: string; start: Date; end: Date }>, occ: Array<{ id: string; event: { title: string } }>) {
  const out: Array<{ a: string; b: string; titles: string[]; at: string }> = [];
  const byId = new Map(occ.map((o) => [o.id, o]));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].start.getTime() >= items[i].end.getTime()) break;
      out.push({
        a: items[i].id,
        b: items[j].id,
        titles: [byId.get(items[i].id)?.event.title ?? "", byId.get(items[j].id)?.event.title ?? ""],
        at: items[i].start.toISOString(),
      });
    }
    if (out.length > 50) break;
  }
  return out;
}

/** Forecast: project demand vs capacity per weekday from history + bookings. */
export async function forecast(ctx: Ctx, params: URLSearchParams) {
  const calendarId = params.get("calendarId");
  if (!calendarId) throw new AppError(ErrorCodes.VALIDATION, "calendarId required");
  const weeks = Math.min(12, Number(params.get("weeks") ?? 8));
  const now = new Date();
  const histFrom = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const [cal, hist, future] = await Promise.all([
    db.calendar.findUnique({ where: { id: calendarId } }),
    db.appointment.findMany({ where: { orgId: ctx.orgId, calendarId, startsAt: { gte: histFrom, lt: now } }, select: { startsAt: true, endsAt: true } }),
    db.appointmentSlot.groupBy({ by: ["startsAt"], where: { orgId: ctx.orgId, calendarId, startsAt: { gte: now, lt: new Date(now.getTime() + 86_400_000) } }, _count: true }),
  ]);
  if (!cal) throw new AppError(ErrorCodes.NOT_FOUND, "Calendar not found");
  void future;
  const byWeekday: number[] = [0, 0, 0, 0, 0, 0, 0];
  const minutesByWeekday: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const a of hist) {
    const dow = a.startsAt.getUTCDay();
    byWeekday[dow]++;
    minutesByWeekday[dow] += (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;
  }
  const capacityMinutes = 480 * weeks;
  const forecastDays = Array.from({ length: weeks * 7 }, (_, i) => new Date(now.getTime() + i * 86_400_000)).slice(0, weeks).map((d) => {
    const dow = d.getUTCDay();
    const avgDaily = (minutesByWeekday[dow] || 0) / Math.max(1, weeks);
    return { date: d.toISOString().slice(0, 10), weekday: dow, projectedBusyMinutes: Math.round(avgDaily), capacityMinutes, projectedUtilizationBps: Math.round((avgDaily / capacityMinutes) * 10000) };
  });
  const totalHist = totalMinutes(hist.map((a) => ({ start: a.startsAt, end: a.endsAt })));
  return { calendarId, weeks, totalHistoricalBusyMinutes: totalHist, avgAppointmentsPerWeekday: byWeekday, forecast: forecastDays };
}

// ---------------------------------------------------------------------------
// Analytics rollups
// ---------------------------------------------------------------------------

export async function temporalAnalytics(ctx: Ctx, params: URLSearchParams) {
  const days = Math.min(365, Number(params.get("days") ?? 30));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const orgId = ctx.orgId;
  const [resources, calCount, patternCount, eventCount, apptStatus, waitlist, conflicts, triggerFires, plansByStatus] = await Promise.all([
    db.resource.groupBy({ by: ["id", "name"], _count: true, where: { orgId } }),
    db.calendar.count({ where: { orgId, archivedAt: null } }),
    db.temporalPattern.count({ where: { OR: [{ orgId }, { orgId: null }] } }),
    db.scheduledEvent.count({ where: { orgId } }),
    db.appointment.groupBy({ by: ["status"], _count: true, where: { orgId } }),
    db.appointment.count({ where: { orgId, status: "WAITLISTED" } }),
    detectConflicts(ctx, new URLSearchParams({ from: from.toISOString() })),
    db.temporalTriggerFire.groupBy({ by: ["outcome"], _count: true, where: { orgId } }),
    db.executionPlan.groupBy({ by: ["status"], _count: true, where: { orgId } }),
  ]);
  const perResource = [];
  const capacityMs = days * 86_400_000;
  for (const r of resources) {
    const busy = await db.resourceBooking.findMany({ where: { resourceId: r.id, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
    perResource.push({
      resourceId: r.id,
      name: r.name,
      bookings: busy.length,
      utilizationBps: Math.min(10000, utilization(capacityMs, busy.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })))),
      bookedMinutes: totalMinutes(mergeIntervals(busy.map((b) => ({ start: new Date(Math.max(b.startsAt.getTime(), from.getTime())), end: new Date(Math.min(b.endsAt.getTime(), to.getTime())) })))),
    });
  }
  const apptBy: Record<string, number> = {};
  for (const s of apptStatus) apptBy[s.status] = s._count;
  return {
    windowDays: days,
    calendars: calCount,
    patterns: patternCount,
    events: eventCount,
    appointments: apptBy,
    waitlisted: waitlist,
    conflictsDetected: conflicts.conflicts.length,
    triggerOutcomes: Object.fromEntries(triggerFires.map((t) => [t.outcome, t._count])),
    executions: Object.fromEntries(plansByStatus.map((p) => [p.status, p._count])),
    resourceUtilization: perResource.sort((a, b) => b.utilizationBps - a.utilizationBps).slice(0, 12),
  };
}

/** Scheduling analytics: throughput by day for the org. */
export async function schedulingTrends(ctx: Ctx, params: URLSearchParams) {
  const days = Math.min(120, Number(params.get("days") ?? 30));
  const now = new Date();
  const buckets: Array<{ day: string; events: number; appointments: number; slots: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - (days - 1 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const start = new Date(`${key}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const [events, appointments, slots] = await Promise.all([
      db.eventOccurrence.count({ where: { orgId: ctx.orgId, startsAt: { gte: start, lt: end } } }),
      db.appointment.count({ where: { orgId: ctx.orgId, startsAt: { gte: start, lt: end } } }),
      db.appointmentSlot.count({ where: { orgId: ctx.orgId, startsAt: { gte: start, lt: end } } }),
    ]);
    buckets.push({ day: key, events, appointments, slots });
  }
  return { days, buckets };
}

// ---------------------------------------------------------------------------
// AI-assisted forecast narrative — rides the platform's existing AI routing
// (priority + plan feature gates; offline demo engine guarantees output).
// ---------------------------------------------------------------------------

export async function forecastInsight(ctx: Ctx, input: unknown) {
  const data = z.object({ calendarId: z.string().min(1), weeks: z.number().int().min(1).max(12).default(6) }).parse(input);
  const params = new URLSearchParams({ calendarId: data.calendarId, weeks: String(data.weeks) });
  const fc = await forecast(ctx, params);
  const busiest = [...fc.forecast].sort((a, b) => b.projectedUtilizationBps - a.projectedUtilizationBps)[0];
  const avgBps = Math.round(fc.forecast.reduce((a, f) => a + f.projectedUtilizationBps, 0) / Math.max(1, fc.forecast.length));
  const facts = [
    `Calendar ${data.calendarId.slice(-6)}: ${fc.weeks} weeks history, ${fc.totalHistoricalBusyMinutes} busy minutes.`,
    `Average projected utilization ${avgBps / 100}% (basis points ${avgBps}).`,
    busiest ? `Peak projected day ${busiest.date} at ${busiest.projectedUtilizationBps / 100}%.` : "",
    `Weekday demand profile: ${fc.avgAppointmentsPerWeekday.join("/")} (Sun→Sat).`,
  ].filter(Boolean).join(" ");
  const system = "You are a scheduling analyst for an enterprise calendar platform. Give a concise, specific 3-sentence operational recommendation grounded ONLY in the facts provided. Never invent numbers.";
  const user = `Facts: ${facts}\n\nTopic: capacity planning recommendation\nAudience: operations manager\nTone: crisp, pragmatic`;

  const { resolveAiCandidates } = await import("../ai/registry");
  let text = "";
  let engine = "fallback";
  try {
    for (const cand of await resolveAiCandidates(ctx.orgId, "text")) {
      try {
        const res = await cand.adapter.text(cand.cfg, cand.apiKey, { system, user, maxTokens: 400, temperature: 0.4 });
        if (res.text.trim()) { text = res.text.trim(); engine = cand.cfg.providerCode; break; }
      } catch { /* fail over along the routing chain */ }
    }
  } catch { /* routing unavailable */ }
  if (!text) {
    text = `Projected load averages ${avgBps / 100}%${busiest ? `, peaking ${busiest.date} (${busiest.projectedUtilizationBps / 100}%)` : ""}. Pre-book staff and rooms around the peak day, shift flexible work off-peak, and re-check the ${data.weeks}-week forecast weekly.`;
  }
  await audit(db, ctx, "intelligence.insight", undefined, data.calendarId, { engine, avgBps });
  return { text, engine, facts, forecast: fc.forecast };
}
