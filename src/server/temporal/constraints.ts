/**
 * UTP Constraint + Availability + Conflict engines (pure).
 *
 * Rules are evaluated against concrete UTC intervals using wall-clock math in
 * the rule timezone, honoring working-day masks and holiday sets. Hard
 * violations block actions; soft rules only warn — same vocabulary used by
 * booking, scheduling, workforce and trigger resolution.
 */

export type Interval = { start: Date; end: Date };

export type RuleLike = {
  id: string;
  type: "BUSINESS_HOURS" | "WORKING_DAYS" | "HOLIDAY" | "COMPLIANCE" | "RESOURCE" | "CAPACITY" | "CUSTOM";
  params: Record<string, unknown>;
  hard: boolean;
  name: string;
  priority: number;
};

export type ConstraintContext = {
  workingDays?: number[]; // default Mon-Fri
  holidays?: Set<string>; // ISO date (UTC day keys)
  /** current usage per resource (used for CAPACITY rules) */
  usage?: { used: number; capacity: number };
  now?: Date;
  /** per-rule holiday sets keyed by rule id (rule params.holidayCalendarId) */
  holidaySets?: Map<string, Set<string>>;
};

export type Violation = { ruleId: string; ruleName: string; type: string; hard: boolean; message: string };

const WD = [1, 2, 3, 4, 5];

function wallParts(d: Date, tz: string) {
  // lightweight Intl cache lives in tz.ts; inline here to keep this pure
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  if (p.hour === 24) p.hour = 0;
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, dow };
}

function minutesOfDay(d: Date, tz: string): number {
  const p = wallParts(d, tz);
  return p.h * 60 + p.mi;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Evaluate one interval against rules. Returns all violations (hard+soft). */
export function evaluateConstraints(iv: Interval, rules: RuleLike[], ctx: ConstraintContext = {}): Violation[] {
  const out: Violation[] = [];
  for (const r of [...rules].sort((a, b) => a.priority - b.priority)) {
    const tz = typeof r.params.timezone === "string" ? r.params.timezone : "UTC";
    const p0 = wallParts(iv.start, tz);
    switch (r.type) {
      case "WORKING_DAYS": {
        const days = Array.isArray(r.params.days) ? (r.params.days as number[]) : ctx.workingDays ?? WD;
        if (!days.includes(p0.dow)) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Day (${p0.dow}) is outside working days` });
        }
        break;
      }
      case "BUSINESS_HOURS": {
        const days = Array.isArray(r.params.days) ? (r.params.days as number[]) : ctx.workingDays ?? WD;
        if (!days.includes(p0.dow)) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: "Outside working days" });
          break;
        }
        const windows = Array.isArray(r.params.windows) ? (r.params.windows as Array<{ start: string; end: string }>) : [];
        const s = minutesOfDay(iv.start, tz);
        const e = minutesOfDay(iv.end, tz);
        const sameDay = iv.start.toISOString().slice(0, 10) === iv.end.toISOString().slice(0, 10);
        const ok = windows.some((w) => {
          const ws = toMin(w.start);
          const we = toMin(w.end);
          const lo = ws <= we ? ws : ws - 1440;
          const hi = ws <= we ? we : we + 1440;
          return sameDay ? s >= lo && e <= hi : s >= lo;
        });
        if (!windows.length) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: "Rule has no windows" });
        else if (!ok) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Outside business hours (${windows.map((w) => `${w.start}-${w.end}`).join(", ")})` });
        break;
      }
      case "HOLIDAY": {
        const set = ctx.holidaySets?.get(r.id) ?? ctx.holidays;
        const key = `${p0.y}-${String(p0.mo).padStart(2, "0")}-${String(p0.d).padStart(2, "0")}`;
        const annual = `${String(p0.mo).padStart(2, "0")}-${String(p0.d).padStart(2, "0")}`;
        if (set?.has(key) || set?.has(annual)) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Date ${key} is a holiday` });
        break;
      }
      case "CAPACITY": {
        const cap = Number(r.params.capacity ?? ctx.usage?.capacity ?? 1);
        const used = Number(ctx.usage?.used ?? 0);
        if (used >= cap) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Capacity full (${used}/${cap})` });
        break;
      }
      case "COMPLIANCE": {
        const minNoticeHours = Number(r.params.minNoticeHours ?? 0);
        if (minNoticeHours > 0 && ctx.now) {
          const lead = (iv.start.getTime() - ctx.now.getTime()) / 3_600_000;
          if (lead < minNoticeHours) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Needs ≥${minNoticeHours}h notice (got ${Math.max(0, lead).toFixed(1)}h)` });
        }
        const maxHorizonDays = Number(r.params.maxHorizonDays ?? 0);
        if (maxHorizonDays > 0 && ctx.now && iv.start.getTime() - ctx.now.getTime() > maxHorizonDays * 86_400_000) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Beyond booking horizon of ${maxHorizonDays}d` });
        }
        break;
      }
      case "RESOURCE": {
        if (r.params.active === false) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: "Resource inactive" });
        if (r.params.requiresApproval === true) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: false, message: "Resource requires approval" });
        }
        break;
      }
      case "CUSTOM": {
        const maxMinutes = Number(r.params.maxMinutes ?? 0);
        const len = (iv.end.getTime() - iv.start.getTime()) / 60_000;
        if (maxMinutes > 0 && len > maxMinutes) out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: `Longer than ${maxMinutes}min limit` });
        const expression = typeof r.params.expression === "string" ? r.params.expression : null;
        if (expression === "DARK_HOURS_BLOCKED" && (minutesOfDay(iv.start, tz) >= (Number(r.params.nightStart ?? 22)) * 60 || minutesOfDay(iv.start, tz) < (Number(r.params.nightEnd ?? 6)) * 60)) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: "Blocked during dark hours" });
        }
        if (expression === "NOT_WEEKEND" && [0, 6].includes(p0.dow)) {
          out.push({ ruleId: r.id, ruleName: r.name, type: r.type, hard: r.hard, message: "Weekend not allowed" });
        }
        break;
      }
    }
  }
  return out;
}

export function isBlocked(violations: Violation[]): boolean {
  return violations.some((v) => v.hard);
}

// ---------------------------------------------------------------------------
// Availability: open windows minus blackouts/bookings, slotted
// ---------------------------------------------------------------------------

export type OpenWindow = Interval & { reason?: string };

/** subtract `holes` from each open window (both sorted). */
export function subtractIntervals(base: Interval[], holes: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const w of base) {
    let cursor = w.start.getTime();
    for (const h of holes.filter((x) => x.end.getTime() > w.start.getTime() && x.start.getTime() < w.end.getTime()).sort((a, b) => a.start.getTime() - b.start.getTime())) {
      if (h.start.getTime() > cursor) out.push({ start: new Date(cursor), end: h.start });
      cursor = Math.max(cursor, h.end.getTime());
      if (cursor >= w.end.getTime()) break;
    }
    if (cursor < w.end.getTime()) out.push({ start: new Date(cursor), end: w.end });
  }
  return out;
}

/**
 * Slot a window list into candidate intervals of `slotMinutes` (with duration
 * + buffer). Returns up to `max` earliest slots starting after `after`.
 */
export function slotWindows(
  windows: Interval[],
  slotMinutes: number,
  durationMinutes: number,
  after: Date,
  max = 20,
  alignMinutes = 5,
): Interval[] {
  const out: Interval[] = [];
  const step = Math.max(1, slotMinutes) * 60_000;
  for (const w of windows) {
    let t = Math.max(w.start.getTime(), after.getTime() + 60_000);
    const rem = t % (alignMinutes * 60_000);
    if (rem) t += alignMinutes * 60_000 - rem;
    while (t + durationMinutes * 60_000 <= w.end.getTime() && out.length < max) {
      out.push({ start: new Date(t), end: new Date(t + durationMinutes * 60_000) });
      t += step;
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, max);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Conflict scan over a list; returns offending pairs. */
export function findConflicts(items: Array<{ id: string } & Interval>): Array<{ a: string; b: string }> {
  const out: Array<{ a: string; b: string }> = [];
  const sorted = [...items].sort((x, y) => x.start.getTime() - y.start.getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start.getTime() >= sorted[i].end.getTime()) break;
      out.push({ a: sorted[i].id, b: sorted[j].id });
    }
  }
  return out;
}

/** Merge touching/overlapping intervals (utilization math). */
export function mergeIntervals(items: Interval[]): Interval[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].start.getTime() <= last.end.getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), sorted[i].end.getTime()));
    } else {
      out.push({ start: sorted[i].start, end: sorted[i].end });
    }
  }
  return out;
}

export function totalMinutes(items: Interval[]): number {
  return Math.round(mergeIntervals(items).reduce((acc, x) => acc + (x.end.getTime() - x.start.getTime()), 0) / 60_000);
}
