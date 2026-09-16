/**
 * UTP Recurrence Engine — turns a declarative spec into an (optionally
 * infinite) stream of concrete occurrences over a window. All times are
 * zone-local wall-clock interpreted through tz, so DST is respected.
 *
 * Supports daily/weekly/monthly/quarterly/yearly (+ interval), by-weekday,
 * by-month-day, by-set-pos (FIRST/LAST weekday of period), custom month sets,
 * business-day filtering, COUNT and UNTIL bounds. Infinite recurrences are
 * materialized lazily per window (never expanded across unbounded time).
 */

import type { RecurrenceFreq } from "@/generated/prisma/enums";
import { wallToUtc, utcToWall } from "./tz";

export type RecurrenceSpec = {
  freq: RecurrenceFreq;
  interval?: number;
  time?: string | null; // "HH:MM"
  weekdays?: number[]; // 0=Sun..6=Sat (weekly / custom)
  monthdays?: number[]; // monthly absolute days (1..31)
  months?: number[]; // 1..12 for yearly/quarterly gating
  setPos?: number; // nth weekday in period (neg = from end)
  posWeekday?: number; // weekday for setPos
  byBusinessDay?: boolean; // restrict to workingDays
  workingDays?: number[]; // 0..6; default Mon-Fri
  count?: number;
  until?: string | null; // ISO date
  durationMinutes?: number;
  weekStartsOn?: number;
  customRule?: string; // "LAST_BUSINESS_DAY_OF_QUARTER" etc.
};

export type Occurrence = { startsAt: Date; endsAt: Date; index: number };

const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

function parseTime(t: string | null | undefined): { h: number; m: number } {
  if (!t) return { h: 9, m: 0 };
  const [hh, mm] = t.split(":").map((x) => Number(x) || 0);
  return { h: ((hh % 24) + 24) % 24, m: ((mm % 60) + 60) % 60 };
}

function periodDays(spec: RecurrenceSpec): number {
  switch (spec.freq) {
    case "SECONDLY":
    case "MINUTELY":
    case "HOURLY":
      return 1;
    case "WEEKLY":
      return 7;
    case "DAILY":
      return 1;
    case "MONTHLY":
      return 31;
    case "QUARTERLY":
      return 92;
    case "YEARLY":
    case "CUSTOM":
      return 366;
    default:
      return 1;
  }
}

function withinWorkingDay(y: number, mo: number, d: number, workingDays: number[]): boolean {
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return workingDays.includes(dow);
}

/** nth occurrence of weekday `wd` within [startOfMonth, endOfMonth]; pos<0 from end. */
function nthWeekdayInMonth(year: number, month: number, wd: number, pos: number): Date | null {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const matches: number[] = [];
  for (let d = 1; d <= lastDay; d++) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === wd) matches.push(d);
  }
  if (!matches.length) return null;
  const idx = pos < 0 ? matches.length + pos : pos - 1;
  if (idx < 0 || idx >= matches.length) return null;
  return new Date(Date.UTC(year, month - 1, matches[idx]));
}

function businessDaysBetween(fromUtc: Date, toUtc: Date, workingDays: number[]): Date[] {
  const out: Date[] = [];
  for (let t = fromUtc.getTime(); t <= toUtc.getTime(); t += 86_400_000) {
    const d = new Date(t);
    if (withinWorkingDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), workingDays)) out.push(d);
  }
  return out;
}

/**
 * Resolve a custom named rule to a set of candidate days inside [wStart,wEnd].
 * Only needs the matching days; the caller applies time + bounds.
 */
function resolveCustom(
  rule: string,
  wStart: Date,
  wEnd: Date,
  workingDays: number[],
): Date[] {
  const days: Date[] = [];
  const pushUnique = (d: Date | null) => {
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    if (d >= wStart && d <= wEnd && !days.some((x) => x.toISOString().slice(0, 10) === key)) days.push(d);
  };
  const start = utcToWall(wStart, "UTC");
  const end = utcToWall(wEnd, "UTC");
  const y0 = start.y;
  const y1 = end.y;

  if (rule === "FIRST_WORKING_DAY_OF_YEAR") {
    for (let y = y0; y <= y1; y++) {
      for (let d = 1; d <= 7 && !days.length; d++) {
        if (withinWorkingDay(y, 1, d, workingDays)) pushUnique(new Date(Date.UTC(y, 0, d)));
      }
    }
  } else if (rule === "LAST_BUSINESS_DAY_OF_QUARTER") {
    const quarters = [3, 6, 9, 12];
    for (let y = y0; y <= y1; y++) {
      for (const mo of quarters) {
        const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        for (let d = lastDay; d >= 1; d--) {
          if (withinWorkingDay(y, mo, d, workingDays)) {
            pushUnique(new Date(Date.UTC(y, mo - 1, d)));
            break;
          }
        }
      }
    }
  } else if (rule === "ALL_BUSINESS_DAYS") {
    for (const d of businessDaysBetween(wStart, wEnd, workingDays)) pushUnique(d);
  } else if (rule === "FIRST_MONDAY_OF_MONTH") {
    for (let y = y0; y <= y1; y++) for (let mo = 1; mo <= 12; mo++) pushUnique(nthWeekdayInMonth(y, mo, 1, 1));
  } else if (rule === "LAST_FRIDAY_OF_MONTH") {
    for (let y = y0; y <= y1; y++) for (let mo = 1; mo <= 12; mo++) pushUnique(nthWeekdayInMonth(y, mo, 5, -1));
  } else if (rule === "EVERY_MONTH_1ST") {
    for (let y = y0; y <= y1; y++) for (let mo = 1; mo <= 12; mo++) pushUnique(new Date(Date.UTC(y, mo - 1, 1)));
  } else if (rule === "EVERY_MONTH_LAST") {
    for (let y = y0; y <= y1; y++) {
      for (let mo = 1; mo <= 12; mo++) pushUnique(new Date(Date.UTC(y, mo - 1, new Date(Date.UTC(y, mo, 0)).getUTCDate())));
    }
  }
  return days.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Stream occurrences for spec over [wStart, wEnd] in `tz`. Bounded by
 * spec.count/spec.until and hard-capped at max to avoid pathological loops.
 * `holidays` (UTC ms-day keys) are excluded when byBusinessDay is set.
 */
export function materialize(
  spec: RecurrenceSpec,
  wStart: Date,
  wEnd: Date,
  tz = "UTC",
  opts: { max?: number; holidays?: Set<string> } = {},
): Occurrence[] {
  const max = opts.max ?? 500;
  const holidays = opts.holidays ?? new Set<string>();
  const time = parseTime(spec.time);
  const dur = Math.max(0, spec.durationMinutes ?? 0);
  const interval = Math.max(1, spec.interval ?? 1);
  const workingDays = spec.workingDays?.length ? spec.workingDays : DEFAULT_WORKDAYS;
  const anchor = wStart;
  const out: Occurrence[] = [];
  const seen = new Set<number>();

  const emit = (dayUtc: Date): boolean => {
    const wall = utcToWall(dayUtc, "UTC");
    const start = wallToUtc(tz, wall.y, wall.mo, wall.d, time.h, time.m);
    if (spec.byBusinessDay && holidays.has(start.toISOString().slice(0, 10))) return false;
    const key = start.getTime();
    if (seen.has(key)) return false;
    seen.add(key);
    const end = new Date(start.getTime() + dur * 60_000);
    out.push({ startsAt: start, endsAt: end, index: out.length });
    return out.length >= max || (spec.count != null && out.length >= spec.count);
  };

  if (spec.freq === "NONE") {
    const wall = utcToWall(anchor, tz);
    const start = wallToUtc(tz, wall.y, wall.mo, wall.d, time.h, time.m);
    if (start >= wStart && start <= wEnd) {
      out.push({ startsAt: start, endsAt: new Date(start.getTime() + dur * 60_000), index: 0 });
    }
    return out;
  }

  if (spec.freq === "CUSTOM") {
    const days = resolveCustom(spec.customRule ?? "", wStart, wEnd, workingDays);
    for (const d of days) {
      if (emit(d)) break;
    }
    return out;
  }

  if (spec.freq === "SECONDLY" || spec.freq === "MINUTELY" || spec.freq === "HOURLY") {
    const stepSec = spec.freq === "SECONDLY" ? interval : spec.freq === "MINUTELY" ? interval * 60 : interval * 3600;
    let t = Math.ceil(wStart.getTime() / 1000 / stepSec) * stepSec * 1000;
    const cap = t + (wEnd.getTime() - wStart.getTime());
    while (t <= cap && out.length < max) {
      const d = new Date(t);
      const wall = utcToWall(d, tz);
      const start = wallToUtc(tz, wall.y, wall.mo, wall.d, wall.h, wall.mi, wall.s);
      out.push({ startsAt: start, endsAt: new Date(start.getTime() + dur * 60_000), index: out.length });
      if (spec.count != null && out.length >= spec.count) break;
      t += stepSec * 1000;
    }
    return out;
  }

  const untilMs = spec.until ? new Date(spec.until).getTime() : Infinity;

  // iterate period-by-period
  const stepUnit =
    spec.freq === "DAILY" ? "DAYS" : spec.freq === "WEEKLY" ? "WEEKS" : spec.freq === "MONTHLY" ? "MONTHS" : spec.freq === "QUARTERLY" ? "QUARTERS" : "YEARS";
  const stepAmount = interval;
  let periodCursor = new Date(Date.UTC(
    utcToWall(wStart, tz).y,
    utcToWall(wStart, tz).mo - 1,
    utcToWall(wStart, tz).d,
  ));
  const guard = 0;

  for (let iter = 0; iter < 5000 && out.length < max; iter++) {
    const pw = utcToWall(periodCursor, tz);
    const daysInPeriod: Array<{ y: number; mo: number; d: number }> = [];

    const addCandidatesForPeriod = () => {
      if (spec.freq === "DAILY") {
        daysInPeriod.push({ y: pw.y, mo: pw.mo, d: pw.d });
      } else if (spec.freq === "WEEKLY") {
        const base = new Date(Date.UTC(pw.y, pw.mo - 1, pw.d));
        const wdays = spec.weekdays?.length ? spec.weekdays : [base.getUTCDay()];
        for (let off = 0; off < 7; off++) {
          const dd = new Date(base.getTime() + off * 86_400_000);
          if (wdays.includes(dd.getUTCDay())) {
            const w2 = utcToWall(dd, "UTC");
            daysInPeriod.push({ y: w2.y, mo: w2.mo, d: w2.d });
          }
        }
      } else {
        // MONTHLY / QUARTERLY / YEARLY share sub-day candidate logic
        const monthsToScan =
          spec.freq === "MONTHLY" ? [pw.mo] : spec.freq === "QUARTERLY" ? [pw.mo, pw.mo + 1, pw.mo + 2] : (spec.months?.length ? spec.months : [pw.mo]);
        for (const rawMo of monthsToScan) {
          const yy = pw.y + Math.floor((rawMo - 1) / 12);
          const mo = ((rawMo - 1) % 12) + 1;
          if (spec.freq === "YEARLY" && spec.months?.length && !spec.months.includes(mo)) continue;
          if (spec.setPos != null && spec.posWeekday != null) {
            const hit = nthWeekdayInMonth(yy, mo, spec.posWeekday, spec.setPos);
            if (hit) {
              const w = utcToWall(hit, "UTC");
              daysInPeriod.push({ y: w.y, mo: w.mo, d: w.d });
            }
          } else if (spec.monthdays?.length) {
            const lastDay = new Date(Date.UTC(yy, mo, 0)).getUTCDate();
            for (const md of spec.monthdays) {
              const day = md < 0 ? lastDay + 1 + md : md; // negative monthday = from end
              if (day >= 1 && day <= lastDay) daysInPeriod.push({ y: yy, mo, d: day });
            }
          } else {
            const lastDay = new Date(Date.UTC(yy, mo, 0)).getUTCDate();
            const day = Math.min(pw.d, lastDay);
            daysInPeriod.push({ y: yy, mo, d: day });
          }
        }
      }
    };
    addCandidatesForPeriod();

    for (const cand of daysInPeriod) {
      if (spec.byBusinessDay && !withinWorkingDay(cand.y, cand.mo, cand.d, workingDays)) continue;
      const start = wallToUtc(tz, cand.y, cand.mo, cand.d, time.h, time.m);
      if (start < wStart) continue;
      if (start > wEnd || start.getTime() > untilMs) {
        return trimToBounds(out, spec, wStart, wEnd);
      }
      const wall = utcToWall(start, "UTC");
      const day = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d));
      const stop = emit(day);
      if (stop) return trimToBounds(out, spec, wStart, wEnd);
    }

    // advance cursor by period
    periodCursor = new Date(Date.UTC(
      pw.y,
      pw.mo - 1,
      pw.d,
    ));
    const advanced = advancePeriod(periodCursor, stepUnit as "DAYS" | "WEEKS" | "MONTHS" | "QUARTERS" | "YEARS", stepAmount);
    periodCursor = advanced;
    if (periodCursor > wEnd) break;
    void guard;
  }
  return trimToBounds(out, spec, wStart, wEnd);
}

function advancePeriod(d: Date, unit: "DAYS" | "WEEKS" | "MONTHS" | "QUARTERS" | "YEARS", amount: number): Date {
  const w = utcToWall(d, "UTC");
  if (unit === "DAYS") return new Date(Date.UTC(w.y, w.mo - 1, w.d + amount));
  if (unit === "WEEKS") return new Date(Date.UTC(w.y, w.mo - 1, w.d + amount * 7));
  const moAdd = unit === "MONTHS" ? amount : unit === "QUARTERS" ? amount * 3 : amount * 12;
  return new Date(Date.UTC(w.y, w.mo - 1 + moAdd, w.d));
}

function trimToBounds(out: Occurrence[], spec: RecurrenceSpec, wStart: Date, wEnd: Date): Occurrence[] {
  const untilMs = spec.until ? new Date(spec.until).getTime() : Infinity;
  let res = out.filter((o) => o.startsAt >= wStart && o.startsAt <= wEnd && o.startsAt.getTime() <= untilMs);
  if (spec.count != null) res = res.slice(0, spec.count);
  return res;
}

/** next occurrence strictly after `from` for a NONE/simple spec (single-step). */
export function nextOccurrence(spec: RecurrenceSpec, from: Date, tz = "UTC", horizonDays = 730): Occurrence | null {
  const end = new Date(from.getTime() + horizonDays * 86_400_000);
  const occ = materialize(spec, new Date(from.getTime() + 1000), end, tz, { max: 1 });
  return occ[0] ?? null;
}

// ---------------------------------------------------------------------------
// SYSTEM-FRAME materialization — patterns bound to a non-UTC TimeSystem.
//
// Semantics (single, documented, deterministic): one system "day" is exactly
// `unitSeconds` SI seconds; week = 7 units, month = 30 units, quarter = 90,
// year = 360. Time-of-day is a fraction of the unit. Instants are computed in
// system micro-time and converted through units.fromSystemMicros — so a
// "EVERY DAY 09:00" pattern on Mars Sol Coordinated fires when the sol clock
// reads 09:00, spaced one sol (88,775 s) apart, not 24 h.
// SECONDLY/MINUTELY/HOURLY are SI-second intervals and behave identically to
// the Earth frame (a second is a second on every world).
// ---------------------------------------------------------------------------

import type { TimeSystemDef } from "./units";
import { DAY_MICROS, fromSystemMicros, toSystemMicros } from "./units";

/** UTC instant when the system sol-clock reads `minuteOfDay` on sol solIndex.
 *  One system second = 1e6 wall µs, so minute m sits at m×60×1e6 into the sol. */
function systemInstant(solIndex: number, minuteOfDay: number, ts: TimeSystemDef): Date {
  const sysWall = BigInt(solIndex) * DAY_MICROS + BigInt(minuteOfDay) * 60_000_000n;
  return new Date(fromSystemMicros(sysWall, ts));
}

/** sol index containing the given UTC instant (floor — handles pre-epoch). */
function solIndexOf(date: Date, ts: TimeSystemDef): number {
  const wall = toSystemMicros(date.getTime(), ts);
  return Math.floor(Number(wall < 0n ? (wall - DAY_MICROS + 1n) / DAY_MICROS : wall / DAY_MICROS));
}

export function materializeSystem(
  spec: RecurrenceSpec,
  wStart: Date,
  wEnd: Date,
  ts: TimeSystemDef,
  opts: { max?: number } = {},
): Occurrence[] {
  const max = opts.max ?? 500;
  const [hh, mm] = (spec.time ?? "09:00").split(":").map((x) => Number(x) || 0);
  const minuteOfDay = hh * 60 + mm;
  const dur = Math.max(0, spec.durationMinutes ?? 0);
  const interval = Math.max(1, spec.interval ?? 1);
  const out: Occurrence[] = [];
  const untilMs = spec.until ? new Date(spec.until).getTime() : Infinity;

  const push = (start: Date): boolean => {
    if (start < wStart || start > wEnd || start.getTime() > untilMs) return false;
    const end = new Date(start.getTime() + dur * 60_000);
    out.push({ startsAt: start, endsAt: end, index: out.length });
    if (out.length >= max || (spec.count != null && out.length >= spec.count)) return true;
    return false;
  };

  if (spec.freq === "SECONDLY" || spec.freq === "MINUTELY" || spec.freq === "HOURLY") {
    // SI-space intervals: identical math to the earth frame
    const stepSec = spec.freq === "SECONDLY" ? interval : spec.freq === "MINUTELY" ? interval * 60 : interval * 3600;
    let t = Math.ceil(wStart.getTime() / 1000 / stepSec) * stepSec * 1000;
    while (t <= wEnd.getTime() && out.length < max) {
      if (push(new Date(t))) break;
      t += stepSec * 1000;
    }
    return out;
  }

  if (spec.freq === "NONE") {
    const start = systemInstant(solIndexOf(wStart, ts), minuteOfDay, ts);
    if (start < wStart) push(systemInstant(solIndexOf(wStart, ts) + 1, minuteOfDay, ts));
    else push(start);
    return out;
  }

  const periodLen = spec.freq === "MONTHLY" ? 30 : spec.freq === "QUARTERLY" ? 90 : spec.freq === "YEARLY" ? 360 : spec.freq === "WEEKLY" ? 7 : 1;
  const sol0 = solIndexOf(wStart, ts) - 1;
  const sol1 = solIndexOf(wEnd, ts) + 1;
  const grid0 = Math.floor(sol0 / periodLen);

  for (let sol = sol0; sol <= sol1 && out.length < max; sol++) {
    if (spec.freq === "DAILY" && (sol - sol0) % interval !== 0) continue;

    if (spec.freq === "WEEKLY") {
      const weekIdx = Math.floor(sol / 7);
      if ((weekIdx - Math.floor(sol0 / 7)) % interval !== 0) continue;
      const sow = ((sol % 7) + 7) % 7;
      const wdays = spec.weekdays?.length ? spec.weekdays : [((sol0 % 7) + 7) % 7];
      if (!wdays.includes(sow)) continue;
    }

    if (spec.freq === "MONTHLY" || spec.freq === "QUARTERLY" || spec.freq === "YEARLY") {
      const period = Math.floor(sol / periodLen);
      if ((period - grid0) % interval !== 0) continue;
      const within = ((sol % periodLen) + periodLen) % periodLen;
      if (spec.freq === "YEARLY" && spec.months?.length) {
        const monthIdx = Math.floor(((((sol % 360) + 360) % 360)) / 30);
        if (!spec.months.includes(monthIdx + 1)) continue;
      }
      if (spec.setPos != null && spec.posWeekday != null) {
        const matches: number[] = [];
        for (let d = 0; d < periodLen; d++) if ((((period * periodLen + d) % 7) + 7) % 7 === spec.posWeekday) matches.push(d);
        const idx = spec.setPos < 0 ? matches.length + spec.setPos : spec.setPos - 1;
        if (matches[idx] !== within) continue;
      } else if (spec.monthdays?.length) {
        const norm = spec.monthdays.map((md) => (md < 0 ? periodLen + md : md));
        if (!norm.includes(within)) continue;
      } else {
        const anchor = (((sol0 % periodLen) + periodLen) % periodLen);
        if (within !== anchor) continue;
      }
    }

    const start = systemInstant(sol, minuteOfDay, ts);
    if (start < wStart || start > wEnd || start.getTime() > untilMs) continue;
    if (out.some((o) => o.startsAt.getTime() === start.getTime())) continue;
    const end = new Date(start.getTime() + dur * 60_000);
    out.push({ startsAt: start, endsAt: end, index: out.length });
    if (out.length >= max || (spec.count != null && out.length >= spec.count)) break;
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, spec.count ?? max)
    .filter((o) => o.startsAt.getTime() <= untilMs && o.startsAt >= wStart && o.startsAt <= wEnd)
    .map((o, i) => ({ ...o, index: i }));
}
