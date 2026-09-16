/**
 * UTP Temporal DSL — parse / compile / validate / optimize / plan.
 *
 * The DSL is a deliberately small, total grammar (case-insensitive):
 *
 *   EVERY WEEKDAY 09:00                 → DAILY, Mon-Fri, 09:00
 *   EVERY DAY AT 09:00                  → DAILY 09:00
 *   EVERY 15 MINUTES                    → MINUTELY interval 15
 *   EVERY 30 SECONDS                    → SECONDLY interval 30
 *   EVERY 2 HOURS FROM 10:00 TO 18:00   → HOURLIY within a window
 *   EVERY MONDAY 10:00                  → WEEKLY weekdays=[1]
 *   EVERY 15 DAYS                       → DAILY interval 15
 *   FIRST MONDAY OF MONTH               → MONTHLY setPos=1 posWeekday=1
 *   LAST FRIDAY OF MONTH                → MONTHLY setPos=-1 posWeekday=5
 *   LAST BUSINESS DAY OF QUARTER        → CUSTOM rule
 *   FIRST WORKING DAY OF YEAR           → CUSTOM rule
 *   EVERY MONTH 1ST / 15TH / LAST       → MONTHLY monthdays
 *   EVERY YEAR ON 01-01 09:00           → YEARLY months=[1] monthdays=[1]
 *   AT 2027-12-31T10:00:00Z             → NONE absolute
 *   +7 DAYS / IN +2 HOURS               → relative single (trigger)
 *   AFTER EVENT(APPROVAL)+7D            → trigger event-relative
 *   BEFORE EVENT(LAUNCH)-2H             → trigger event-relative
 *   WHEN RESOURCE_AVAILABLE(code)       → trigger resource
 *   WHEN CAPACITY_AVAILABLE(code)       → trigger capacity
 *   WHEN TEAM_AVAILABLE(code)           → trigger team
 *   AT SUNRISE / AT SUNSET / AT GOLDEN_HOUR
 *   AFTER FULL_MOON / AT NEW_MOON       → trigger astronomical
 *   BETWEEN 09:00 AND 18:00             → TIME_RANGE
 *   FROM 2027-01-01 TO 2027-03-31       → DATE_RANGE
 *   24x7                                → continuous window
 *   <expr> UNION <expr>                 → composite (merge two specs)
 *   <expr> AND <expr>                   → intersection marker (planner)
 */

import type { RecurrenceFreq } from "@/generated/prisma/enums";
import type { RecurrenceSpec } from "./recurrence";

export type DslDiagnostic = { level: "error" | "warning" | "info"; code: string; message: string };

export type CompiledTrigger = {
  anchorType: "ABSOLUTE" | "RELATIVE" | "EVENT_BEFORE" | "EVENT_AFTER" | "RESOURCE_AVAILABLE" | "CAPACITY_AVAILABLE" | "TEAM_AVAILABLE" | "ASTRONOMICAL" | "CUSTOM";
  at?: string;
  offsetMinutes?: number;
  eventCode?: string;
  resourceCode?: string;
  astroEvent?: string;
  raw: string;
};

export type Compiled =
  | { kind: "pattern"; spec: RecurrenceSpec; warnings: DslDiagnostic[] }
  | { kind: "trigger"; trigger: CompiledTrigger; warnings: DslDiagnostic[] }
  | { kind: "range"; range: { kind: string; timeStart?: string; timeEnd?: string; dateStart?: string; dateEnd?: string; continuous?: boolean }; warnings: DslDiagnostic[] };

export class DslError extends Error {
  diagnostics: DslDiagnostic[];
  constructor(message: string, diagnostics?: DslDiagnostic[]) {
    super(message);
    this.diagnostics = diagnostics ?? [{ level: "error", code: "PARSE", message }];
  }
}

const WEEKDAY_NAMES: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const MONTH_NAMES: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  JAN: 1, FEB: 2, MAR: 3, APR: 4, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
void MONTH_NAMES;

const UNIT_MAP: Record<string, { freq: RecurrenceFreq; minutesPer: number; key: string }> = {
  SECONDS: { freq: "SECONDLY", minutesPer: 1 / 60, key: "SECONDS" },
  SECOND: { freq: "SECONDLY", minutesPer: 1 / 60, key: "SECONDS" },
  SEC: { freq: "SECONDLY", minutesPer: 1 / 60, key: "SECONDS" },
  MINUTES: { freq: "MINUTELY", minutesPer: 1, key: "MINUTES" },
  MINUTE: { freq: "MINUTELY", minutesPer: 1, key: "MINUTES" },
  MIN: { freq: "MINUTELY", minutesPer: 1, key: "MINUTES" },
  HOURS: { freq: "HOURLY", minutesPer: 60, key: "HOURS" },
  HOUR: { freq: "HOURLY", minutesPer: 60, key: "HOURS" },
  HR: { freq: "HOURLY", minutesPer: 60, key: "HOURS" },
  DAYS: { freq: "DAILY", minutesPer: 1440, key: "DAYS" },
  DAY: { freq: "DAILY", minutesPer: 1440, key: "DAYS" },
  WEEKS: { freq: "WEEKLY", minutesPer: 10080, key: "WEEKS" },
  WEEK: { freq: "WEEKLY", minutesPer: 10080, key: "WEEKS" },
  MONTHS: { freq: "MONTHLY", minutesPer: 43200, key: "MONTHS" },
  MONTH: { freq: "MONTHLY", minutesPer: 43200, key: "MONTHS" },
  QUARTERS: { freq: "QUARTERLY", minutesPer: 129600, key: "QUARTERS" },
  QUARTER: { freq: "QUARTERLY", minutesPer: 129600, key: "QUARTERS" },
  YEARS: { freq: "YEARLY", minutesPer: 518400, key: "YEARS" },
  YEAR: { freq: "YEARLY", minutesPer: 518400, key: "YEARS" },
};

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/;

function timeStr(t: string): { h: number; m: number } | null {
  const m = TIME_RE.exec(t);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function ordinalWeekday(w: string): { pos: number; wd: number } | null {
  const m = /^(FIRST|SECOND|THIRD|FOURTH|FIFTH|LAST)\s+(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUN|MON|TUE|WED|THU|FRI|SAT)$/.exec(w);
  if (!m) return null;
  const pos = m[1] === "LAST" ? -1 : ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH"].indexOf(m[1]) + 1;
  return { pos, wd: WEEKDAY_NAMES[m[2]] };
}

/** Tokenize, upper-cased, punctuation kept where meaningful. */
function lex(src: string): string[] {
  return src
    .toUpperCase()
    .replace(/\b24X7\b/g, " 24X7 ")
    .replace(/\(([A-Z0-9_.:-]+)\)/g, "($1)")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Parse DSL text into a compiled artifact. Throws DslError with diagnostics
 * on unparseable input. Supports UNION composition of two pattern exprs.
 */
export function parseDsl(srcRaw: string): Compiled {
  const src = srcRaw.trim();
  if (!src) throw new DslError("Empty expression");
  const warnings: DslDiagnostic[] = [];

  // top-level composition
  const unionParts = splitKeyword(src, "UNION");
  if (unionParts.length > 1) {
    const specs: RecurrenceSpec[] = [];
    for (const p of unionParts) {
      const c = parseDsl(p);
      if (c.kind !== "pattern") throw new DslError("UNION operands must be pattern expressions");
      specs.push(c.spec);
    }
    return { kind: "pattern", spec: mergeSpecs(specs), warnings };
  }

  const toks = lex(src);

  // --- ranges ---------------------------------------------------------
  if (toks[0] === "BETWEEN" && toks.includes("AND")) {
    const i = toks.indexOf("AND");
    const a = timeStr(toks[1] ?? "");
    const b = timeStr(toks[i + 1] ?? "");
    if (!a || !b) throw new DslError("BETWEEN requires two HH:MM times");
    return { kind: "range", range: { kind: "TIME_RANGE", timeStart: toks[1], timeEnd: toks[i + 1] }, warnings };
  }
  if (toks[0] === "FROM" && toks.includes("TO")) {
    const i = toks.indexOf("TO");
    const a = toks[1];
    const b = toks[i + 1];
    if (!a || !b || !ISO_RE.test(a) || !ISO_RE.test(b)) throw new DslError("FROM/TO need ISO dates");
    return { kind: "range", range: { kind: "DATE_RANGE", dateStart: a, dateEnd: b }, warnings };
  }
  if (toks.includes("24X7")) {
    return { kind: "range", range: { kind: "TIME_RANGE", continuous: true, timeStart: "00:00", timeEnd: "23:59" }, warnings };
  }
  if (toks[0] === "TODAY") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "today", dateEnd: "today" }, warnings };
  if (toks[0] === "TOMORROW") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "tomorrow", dateEnd: "tomorrow" }, warnings };
  if (toks[0] === "THIS" && toks[1] === "WEEK") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "this_week", dateEnd: "this_week" }, warnings };
  if (toks[0] === "NEXT" && toks[1] === "WEEK") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "next_week", dateEnd: "next_week" }, warnings };
  if (toks[0] === "THIS" && toks[1] === "MONTH") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "this_month", dateEnd: "this_month" }, warnings };
  if (toks[0] === "NEXT" && toks[1] === "MONTH") return { kind: "range", range: { kind: "DATE_RANGE", dateStart: "next_month", dateEnd: "next_month" }, warnings };
  if (toks[0]?.startsWith("+") || toks[0]?.startsWith("-") || (toks[0] === "IN" && toks[1]?.startsWith("+"))) {
    const rel = toks[0] === "IN" ? toks.slice(1) : toks;
    const t = relativeTrigger(rel.join(" "), src);
    if (t) return { kind: "trigger", trigger: t, warnings };
  }

  // --- triggers -------------------------------------------------------
  if (toks[0] === "AFTER" && toks[1]?.startsWith("EVENT")) {
    const t = eventTrigger(src, "EVENT_AFTER");
    if (t) return { kind: "trigger", trigger: t, warnings };
    throw new DslError(`Cannot parse event trigger: ${src}`);
  }
  if (toks[0] === "BEFORE" && toks[1]?.startsWith("EVENT")) {
    const t = eventTrigger(src, "EVENT_BEFORE");
    if (t) return { kind: "trigger", trigger: t, warnings };
    throw new DslError(`Cannot parse event trigger: ${src}`);
  }
  if (toks[0] === "WHEN") {
    const m = /WHEN\s+(RESOURCE|CAPACITY|TEAM)_?AVAILABLE(?:\(([^)]+)\))?/.exec(src.toUpperCase());
    if (m) {
      const type = ({ RESOURCE: "RESOURCE_AVAILABLE", CAPACITY: "CAPACITY_AVAILABLE", TEAM: "TEAM_AVAILABLE" } as const)[m[1] as "RESOURCE" | "CAPACITY" | "TEAM"];
      return { kind: "trigger", trigger: { anchorType: type, resourceCode: m[2] || undefined, raw: src }, warnings };
    }
    throw new DslError(`Cannot parse WHEN trigger: ${src}`);
  }
  if (toks[0] === "AT" && ["SUNRISE", "SUNSET", "GOLDEN_HOUR", "SOLAR_NOON", "CIVIL_DAWN", "CIVIL_DUSK"].includes(toks[1])) {
    return { kind: "trigger", trigger: { anchorType: "ASTRONOMICAL", astroEvent: toks[1], offsetMinutes: parseTrailingOffset(src), raw: src }, warnings };
  }
  if ((toks[0] === "AT" || toks[0] === "AFTER") && ["NEW_MOON", "FULL_MOON", "FIRST_QUARTER", "LAST_QUARTER"].includes(toks[1])) {
    return { kind: "trigger", trigger: { anchorType: "ASTRONOMICAL", astroEvent: toks[1], offsetMinutes: toks[0] === "AFTER" ? 0 : 0, raw: src }, warnings };
  }

  // --- absolute time --------------------------------------------------
  if (toks[0] === "AT" && ISO_RE.test(toks[1] ?? "")) {
    return { kind: "trigger", trigger: { anchorType: "ABSOLUTE", at: toks[1], raw: src }, warnings };
  }
  if (ISO_RE.test(toks[0])) {
    return { kind: "trigger", trigger: { anchorType: "ABSOLUTE", at: toks[0], raw: src }, warnings };
  }

  // --- patterns -------------------------------------------------------
  const spec = parsePattern(toks, src);
  if (!spec) throw new DslError(`Unrecognized temporal expression: "${src}"`);
  return { kind: "pattern", spec, warnings };
}

function splitKeyword(src: string, kw: string): string[] {
  const re = new RegExp(`\\s${kw}\\s`, "i");
  if (!re.test(src)) return [src];
  return src.split(re).map((s) => s.trim()).filter(Boolean);
}

function parseTrailingOffset(src: string): number | undefined {
  const m = /([+-]\d+)\s*(M|MIN|H|HOURS?|D|DAYS?)?\b\s*$/i.exec(src.trim());
  if (!m) return undefined;
  const v = Number(m[1]);
  const u = (m[2] ?? "M").toUpperCase();
  return v * (u.startsWith("H") ? 60 : u.startsWith("D") ? 1440 : 1);
}

function relativeTrigger(txt: string, raw: string): CompiledTrigger | null {
  const m = /\+(-?\d+)\s*(S|SEC|MIN|MINS|H|HRS|HR|D|DAYS|W|WK|MONTH|MONTHS)?\b/i.exec(txt.toUpperCase());
  if (!m) return null;
  const v = Number(m[1]);
  const u = (m[2] ?? "D").toUpperCase();
  const mul = u.startsWith("SEC") || u === "S" ? 1 / 60 : u.startsWith("M") && u !== "MONTH" ? 1 : u.startsWith("H") ? 60 : u.startsWith("D") ? 1440 : u.startsWith("W") ? 10080 : 43200;
  return { anchorType: "RELATIVE", offsetMinutes: Math.round(v * mul), raw };
}

function eventTrigger(src: string, kind: "EVENT_AFTER" | "EVENT_BEFORE"): CompiledTrigger | null {
  const m = /(AFTER|BEFORE)\s+EVENT\(([A-Z0-9_.:-]+)\)\s*([+-]\d+)?\s*([A-Z]*)/i.exec(src);
  if (!m) return null;
  const code = m[2].toUpperCase();
  const val = m[3] ? Number(m[3]) : 0;
  const unitRaw = (m[4] || "D").toUpperCase();
  const mul = unitRaw.startsWith("H") ? 60 : unitRaw.startsWith("M") ? 1 : unitRaw.startsWith("S") ? 1 / 60 : 1440;
  const offset = Math.abs(val) * mul * (kind === "EVENT_BEFORE" ? -1 : 1);
  return { anchorType: kind, eventCode: code, offsetMinutes: Math.round(offset), raw: src };
}

function parsePattern(toks: string[], srcRaw: string): RecurrenceSpec | null {
  if (toks[0] !== "EVERY" && toks[0] !== "ON") {
    if (/^(FIRST|SECOND|THIRD|FOURTH|FIFTH|LAST)$/.test(toks[0])) return parsePattern(["EVERY", ...toks], srcRaw);
    return null;
  }
  let i = 1;
  const warn = (code: string, message: string): never | void => { void code; void message; };

  if (toks[i] === "WEEKDAY") {
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(rest2(toks, i), srcRaw);
    return { freq: "DAILY", interval: 1, time, byBusinessDay: true, workingDays: [1, 2, 3, 4, 5], ...rest };
  }
  if (toks[i] === "BUSINESS" && toks[i + 1] === "DAY") {
    i += 2;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: "DAILY", interval: 1, time, byBusinessDay: true, workingDays: [1, 2, 3, 4, 5], ...rest };
  }
  if (/^(FIRST|SECOND|THIRD|FOURTH|FIFTH|LAST)$/.test(toks[i]) && ordinalWeekday(`${toks[i]} ${toks[i + 1] ?? ""}`)) {
    const ord = ordinalWeekday(`${toks[i]} ${toks[i + 1]}`)!;
    i += 2;
    if (toks[i] !== "OF") warn("OF", "expected OF");
    i++;
    const per = toks[i];
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    if (per === "YEAR" || per === "MONTH" || per === "QUARTER") {
      const freq: RecurrenceFreq = per === "YEAR" ? "YEARLY" : per === "QUARTER" ? "QUARTERLY" : "MONTHLY";
      if (per === "YEAR") {
        // first weekday within the year → MONTHLY pos over months [1]
        return { freq: "MONTHLY", months: [1], setPos: ord.pos, posWeekday: ord.wd, time, interval: 1 };
      }
      const rest = tail(toks.slice(i), srcRaw);
      return { freq, interval: per === "QUARTER" ? 1 : 1, months: per === "QUARTER" ? [1, 4, 7, 10] : undefined, setPos: ord.pos, posWeekday: ord.wd, time, ...rest };
    }
    throw new DslError(`Unknown period "${per}" (MONTH/QUARTER/YEAR expected)`);
  }
  if (toks[i] === "LAST" && toks[i + 1] === "BUSINESS" && toks[i + 2] === "DAY" && toks[i + 3] === "OF") {
    const per = toks[i + 4];
    const time = toks[i + 5] && TIME_RE.test(toks[i + 5]) ? toks[i + 5] : "17:00";
    void per;
    return { freq: "CUSTOM", customRule: "LAST_BUSINESS_DAY_OF_QUARTER", time, byBusinessDay: true };
  }
  if (toks[i] === "FIRST" && toks[i + 1] === "WORKING" && toks[i + 2] === "DAY" && toks[i + 3] === "OF") {
    const time = toks[i + 4] && TIME_RE.test(toks[i + 4]) ? toks[i + 4] : "09:00";
    return { freq: "CUSTOM", customRule: "FIRST_WORKING_DAY_OF_YEAR", time };
  }
  if (toks[i] === "ALL" && toks[i + 1] === "BUSINESS" && toks[i + 2] === "DAYS") {
    const time = toks[i + 3] && TIME_RE.test(toks[i + 3]) ? toks[i + 3] : "09:00";
    return { freq: "CUSTOM", customRule: "ALL_BUSINESS_DAYS", time, byBusinessDay: true, workingDays: [1, 2, 3, 4, 5] };
  }
  if (toks[i] === "MONDAY" || toks[i] === "FRIDAY" || (WEEKDAY_NAMES[toks[i]] != null)) {
    const wd = WEEKDAY_NAMES[toks[i]];
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: "WEEKLY", interval: 1, weekdays: [wd], time, ...rest };
  }
  if (toks[i] === "MONTH" && /^(1ST|2ND|3RD|4TH|5TH|LAST|\d+(ST|ND|RD|TH)?)$/.test(toks[i + 1] ?? "")) {
    i++;
    const md = toks[i] === "LAST" ? -1 : Number(toks[i].replace(/(ST|ND|RD|TH)$/, ""));
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: "MONTHLY", interval: 1, monthdays: [md], time, ...rest };
  }
  if (toks[i] === "YEAR" && toks[i + 1] === "ON") {
    i += 2;
    const date = toks[i];
    i++;
    const mm = date && /^(\d{2})-(\d{2})$/.exec(date);
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: "YEARLY", interval: 1, months: mm ? [Number(mm[1])] : [1], monthdays: mm ? [Number(mm[2])] : [1], time, ...rest };
  }
  const num = Number(toks[i]);
  if (Number.isInteger(num) && num > 0 && UNIT_MAP[toks[i + 1] ?? ""]) {
    const u = UNIT_MAP[toks[i + 1]];
    i += 2;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : u.freq === "DAILY" ? "09:00" : null;
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: u.freq, interval: num, time, ...rest };
  }
  if (UNIT_MAP[toks[i]] && (toks[i] === "DAY" || toks[i] === "DAYS")) {
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : "09:00";
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: "DAILY", interval: 1, time, ...rest };
  }
  if (UNIT_MAP[toks[i]]) {
    const u = UNIT_MAP[toks[i]];
    i++;
    const time = toks[i] && TIME_RE.test(toks[i]) ? toks[i++] : null;
    const rest = tail(toks.slice(i), srcRaw);
    return { freq: u.freq, interval: 1, time, ...rest };
  }
  return null;

  function rest2(t: string[], from: number) {
    return t.slice(from);
  }
  function tail(rest: string[], _src: string): Partial<RecurrenceSpec> {
    const out: Partial<RecurrenceSpec> = {};
    let j = 0;
    while (j < rest.length) {
      const t = rest[j];
      if (t === "FROM" && TIME_RE.test(rest[j + 1] ?? "")) {
        (out as Record<string, unknown>).windowStart = rest[j + 1];
        j += 2;
        continue;
      }
      if (t === "TO" && TIME_RE.test(rest[j + 1] ?? "")) {
        (out as Record<string, unknown>).windowEnd = rest[j + 1];
        j += 2;
        continue;
      }
      if (t === "UNTIL" && ISO_RE.test(rest[j + 1] ?? "")) {
        out.until = rest[j + 1];
        j += 2;
        continue;
      }
      if (t === "FOR") {
        const n = Number(rest[j + 1]);
        const u = UNIT_MAP[rest[j + 2] ?? ""];
        if (Number.isInteger(n) && u) {
          out.durationMinutes = n * u.minutesPer;
          j += 3;
          continue;
        }
      }
      if (t === "STARTING" && ISO_RE.test(rest[j + 1] ?? "")) {
        j += 2;
        continue;
      }
      if (t === "ON" && rest[j + 1] && /^[A-Z]+/.test(rest[j + 1]) && WEEKDAY_NAMES[rest[j + 1]] != null) {
        out.weekdays = [WEEKDAY_NAMES[rest[j + 1]]];
        j += 2;
        continue;
      }
      j++;
    }
    return out;
  }
}

function mergeSpecs(specs: RecurrenceSpec[]): RecurrenceSpec {
  const base = specs[0];
  const weekdays = Array.from(new Set(specs.flatMap((s) => s.weekdays ?? []))).sort();
  const sameTime = new Set(specs.map((s) => s.time)).size === 1;
  return {
    ...base,
    freq: "CUSTOM",
    customRule: `UNION::${specs.map((s) => s.freq + (s.time ?? "")).join("+")}`,
    weekdays: weekdays.length ? weekdays : undefined,
    time: sameTime ? base.time : base.time,
  };
}

/** Validator: re-parse + sanity-check a compiled spec. Returns diagnostics. */
export function validateSpec(spec: RecurrenceSpec): DslDiagnostic[] {
  const diags: DslDiagnostic[] = [];
  if (!spec.freq) diags.push({ level: "error", code: "FREQ", message: "Missing freq" });
  if (spec.interval != null && spec.interval < 1) diags.push({ level: "error", code: "INTERVAL", message: "interval must be ≥1" });
  if (spec.count != null && (spec.count < 1 || spec.count > 100_000)) diags.push({ level: "error", code: "COUNT", message: "count must be 1..100000" });
  if (spec.until && Number.isNaN(new Date(spec.until).getTime())) diags.push({ level: "error", code: "UNTIL", message: "until is not a valid date" });
  if (spec.weekdays?.some((d) => d < 0 || d > 6)) diags.push({ level: "error", code: "WEEKDAYS", message: "weekdays must be 0..6" });
  if (spec.monthdays?.some((d) => d === 0 || d < -31 || d > 31)) diags.push({ level: "error", code: "MONTHDAYS", message: "monthdays must be -31..31, not 0" });
  if (spec.setPos != null && Math.abs(spec.setPos) > 5) diags.push({ level: "warning", code: "SETPOS", message: "|setPos| > 5 will never match" });
  const highRes = (spec.freq === "SECONDLY" && (spec.interval ?? 1) < 5) || (spec.freq === "MINUTELY" && (spec.interval ?? 1) === 0);
  if (highRes) diags.push({ level: "warning", code: "COST", message: "sub-5s resolution will be expensive to materialize" });
  if (!diags.some((d) => d.level === "error")) diags.push({ level: "info", code: "OK", message: "valid" });
  return diags;
}

/** Optimizer: normalize equivalent specs (dedupe sorted sets, clamp values). */
export function optimizeSpec(spec: RecurrenceSpec): RecurrenceSpec {
  const out: RecurrenceSpec = { ...spec };
  if (out.weekdays) out.weekdays = Array.from(new Set(out.weekdays)).sort((a, b) => a - b);
  if (out.monthdays) out.monthdays = Array.from(new Set(out.monthdays)).sort((a, b) => a - b);
  if (out.months) out.months = Array.from(new Set(out.months)).sort((a, b) => a - b);
  if (out.interval != null) out.interval = Math.max(1, Math.trunc(out.interval));
  if (out.workingDays) out.workingDays = Array.from(new Set(out.workingDays)).sort((a, b) => a - b);
  return out;
}

/** Execution planner: expansion strategy for materialization. */
export function planExecution(spec: RecurrenceSpec): { expansion: "streaming" | "bounded"; stepSeconds: number; maxPerWindow: number; note: string } {
  const step =
    spec.freq === "SECONDLY" ? Math.max(1, spec.interval ?? 1)
      : spec.freq === "MINUTELY" ? Math.max(60, (spec.interval ?? 1) * 60)
        : spec.freq === "HOURLY" ? Math.max(3600, (spec.interval ?? 1) * 3600)
          : 86400;
  const streaming = spec.freq === "SECONDLY" || spec.freq === "MINUTELY" || spec.freq === "HOURLY";
  return {
    expansion: streaming ? "streaming" : "bounded",
    stepSeconds: step,
    maxPerWindow: streaming ? 2000 : 500,
    note: spec.count != null || spec.until ? "bounded by count/until" : "open-ended; window-bounded",
  };
}

/** Convenience: compile text → spec (pattern only). */
export function compilePattern(dsl: string): RecurrenceSpec {
  const c = parseDsl(dsl);
  if (c.kind !== "pattern") throw new DslError("Expression is not a pattern", [{ level: "error", code: "KIND", message: `compiled to ${c.kind}` }]);
  return optimizeSpec(c.spec);
}
