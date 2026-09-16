/**
 * UTP frame resolver — THE single entry point every service uses to expand a
 * stored pattern. Zero-bypass rule: nothing may call materialize() on a DB
 * pattern row directly; frames (Earth wall-clock vs planetary system) and
 * holiday exclusion are applied consistently for every consumer — preview,
 * series materialization, slots, availability, intelligence, triggers,
 * reports, feeds.
 */

import { db } from "../db";
import { materialize, materializeSystem } from "../temporal/recurrence";
import type { Occurrence, RecurrenceSpec } from "../temporal/recurrence";
import type { TimeSystemDef } from "../temporal/units";

export type PatternLike = {
  spec: unknown;
  timezone: string;
  timeSystemId: string | null;
};

/** Resolve a time-system row into the engine's def (null → Earth frame). */
export async function resolveTimeSystemDef(pattern: PatternLike): Promise<TimeSystemDef | null> {
  if (!pattern.timeSystemId) return null;
  const ts = await db.timeSystem.findUnique({ where: { id: pattern.timeSystemId } });
  if (!ts || !ts.active) return null;
  return { kind: ts.kind, utcOffsetMinutes: ts.utcOffsetMinutes, unitSeconds: ts.unitSeconds, epochMicros: ts.epochMicros };
}

/**
 * Expand a stored pattern over [from,to]: Earth frame via tz wall-clock, or
 * the pattern's bound system frame (planetary/custom). Holiday dates are then
 * excluded (full ISO day or annual MM-DD keys) in BOTH frames.
 */
export async function expandPattern(
  pattern: PatternLike,
  from: Date,
  to: Date,
  opts: { max?: number; holidays?: Set<string> } = {},
): Promise<Occurrence[]> {
  const ts = await resolveTimeSystemDef(pattern);
  const spec = pattern.spec as RecurrenceSpec;
  const out = ts && ts.kind !== "LINEAR_OFFSET"
    ? materializeSystem(spec, from, to, ts, { max: opts.max ?? 500 })
    : materialize(spec, from, to, pattern.timezone, { max: opts.max ?? 500 });
  const holidays = opts.holidays;
  if (!holidays?.size) return out;
  return out.filter((o) => {
    const iso = o.startsAt.toISOString();
    return !holidays.has(iso.slice(0, 10)) && !holidays.has(iso.slice(5, 10));
  });
}

/**
 * The configured holiday set — honors TemporalConfiguration.holidayCalendarId
 * first, falling back to the org's (then the global) calendar. Shared by every
 * consumer so "the calendar you configured" is THE calendar everywhere.
 */
export async function resolveHolidaySet(orgId: string): Promise<Set<string>> {
  const cfg = await db.temporalConfiguration.findUnique({ where: { orgId } });
  let cal = cfg?.holidayCalendarId
    ? await db.holidayCalendar.findFirst({ where: { id: cfg.holidayCalendarId, OR: [{ orgId }, { orgId: null }] } })
    : null;
  if (!cal) {
    cal = await db.holidayCalendar.findFirst({
      where: { OR: [{ orgId }, { orgId: null }] },
      orderBy: [{ orgId: { sort: "desc", nulls: "last" } }, { code: "asc" }],
    });
  }
  if (!cal) return new Set();
  const rows = await db.holiday.findMany({ where: { calendarId: cal.id } });
  return new Set(rows.map((h) => (h.recurringAnnual ? h.date.toISOString().slice(5, 10) : h.date.toISOString().slice(0, 10))));
}

/** Per-rule holiday sets for the constraint engine (rule params.holidayCalendarId). */
export async function resolveHolidaySets(orgId: string, ruleParams: Array<{ id: string; params: unknown }>): Promise<Map<string, Set<string>>> {
  const wanted = new Set<string>();
  for (const r of ruleParams) {
    const p = r.params as { holidayCalendarId?: string };
    if (p?.holidayCalendarId) wanted.add(p.holidayCalendarId);
  }
  const map = new Map<string, Set<string>>();
  if (!wanted.size) return map;
  const defaultSet = await resolveHolidaySet(orgId);
  for (const r of ruleParams) {
    const p = r.params as { holidayCalendarId?: string };
    if (!p?.holidayCalendarId) continue;
    if (p.holidayCalendarId === "default") {
      map.set(r.id, defaultSet);
      continue;
    }
    const cal = await db.holidayCalendar.findFirst({ where: { id: p.holidayCalendarId, OR: [{ orgId }, { orgId: null }] } });
    if (!cal) continue;
    const rows = await db.holiday.findMany({ where: { calendarId: cal.id } });
    map.set(r.id, new Set(rows.map((h) => (h.recurringAnnual ? h.date.toISOString().slice(5, 10) : h.date.toISOString().slice(0, 10)))));
  }
  return map;
}
