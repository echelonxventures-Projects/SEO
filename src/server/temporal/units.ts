/**
 * UTP unit math — integers only. Durations are SI seconds; calendar offsets
 * use (amount, unit) pairs expanded at a reference instant (no float drift).
 * Absolute instants inside a TimeSystem are BigInt microseconds ("t-system
 * micros"); UTC is the default system.
 */

export type TimeUnit =
  | "SECONDS"
  | "MINUTES"
  | "HOURS"
  | "DAYS"
  | "WEEKS"
  | "MONTHS"
  | "QUARTERS"
  | "YEARS";

export const TIME_UNITS: TimeUnit[] = [
  "SECONDS",
  "MINUTES",
  "HOURS",
  "DAYS",
  "WEEKS",
  "MONTHS",
  "QUARTERS",
  "YEARS",
];

const SEC: Record<TimeUnit, number> = {
  SECONDS: 1,
  MINUTES: 60,
  HOURS: 3600,
  DAYS: 86400,
  WEEKS: 604800,
  MONTHS: 0,
  QUARTERS: 0,
  YEARS: 0,
};

/** Simple (non-calendar-month) durations in seconds; months/years return null. */
export function unitToSeconds(unit: TimeUnit): number | null {
  return SEC[unit] === 0 ? null : SEC[unit];
}

/** Calendar-aware: add amount of unit to a UTC Date, returning a new Date. */
export function addUnit(date: Date, amount: number, unit: TimeUnit): Date {
  const d = new Date(date.getTime());
  switch (unit) {
    case "SECONDS":
      d.setSeconds(d.getSeconds() + amount);
      return d;
    case "MINUTES":
      d.setMinutes(d.getMinutes() + amount);
      return d;
    case "HOURS":
      d.setHours(d.getHours() + amount);
      return d;
    case "DAYS":
      d.setDate(d.getDate() + amount);
      return d;
    case "WEEKS":
      d.setDate(d.getDate() + amount * 7);
      return d;
    case "MONTHS":
      d.setMonth(d.getMonth() + amount);
      return d;
    case "QUARTERS":
      d.setMonth(d.getMonth() + amount * 3);
      return d;
    case "YEARS":
      d.setFullYear(d.getFullYear() + amount);
      return d;
  }
}

/** Whole-unit difference a→b (positive when b after a), integer division. */
export function diffIn(a: Date, b: Date, unit: TimeUnit): number {
  const ms = b.getTime() - a.getTime();
  const s = unitToSeconds(unit);
  if (s !== null) return Math.trunc(ms / 1000 / s);
  if (unit === "MONTHS") {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  }
  if (unit === "QUARTERS") {
    return Math.trunc(diffIn(a, b, "MONTHS") / 3);
  }
  return b.getFullYear() - a.getFullYear();
}

export function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

/**
 * A TimeSystem transform: convert between SI Unix microseconds and a
 * system's wall clock. Canonical frame (SOLAR convention):
 *
 *   systemWallMicros = (utc + offset − epoch) × DAY / unitSeconds
 *
 * i.e. exactly one rotation (sol/lune) spans one full 24-h system day, so
 * "09:00 sol time" is well-defined on any world; spacing between consecutive
 * days is unitSeconds of real time (88,775 s for Mars). LINEAR_OFFSET
 * systems keep the SI second grid (wall = UTC + offset).
 */
export type TimeSystemDef = {
  kind: "LINEAR_OFFSET" | "ROTATION" | "CUSTOM";
  utcOffsetMinutes: number;
  unitSeconds: number;
  epochMicros: bigint;
};

export const DAY_MICROS = 86_400_000_000n;

/** Rounded integer division (sign-aware; BigInt / truncates toward zero). */
function divRound(num: bigint, den: bigint): bigint {
  const s = num >= 0n === den >= 0n ? 1n : -1n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  return s * ((a + b / 2n) / b);
}

/** UTC ms → system wall microseconds. */
export function toSystemMicros(utcMs: number, ts: TimeSystemDef): bigint {
  const utcMicros = BigInt(Math.round(utcMs)) * 1000n;
  const offsetMicros = BigInt(ts.utcOffsetMinutes) * 60n * 1_000_000n;
  if (ts.kind === "LINEAR_OFFSET") return utcMicros + offsetMicros - ts.epochMicros;
  const unitMicros = BigInt(ts.unitSeconds) * 1_000_000n;
  return divRound((utcMicros + offsetMicros - ts.epochMicros) * DAY_MICROS, unitMicros);
}

/** System wall microseconds → UTC ms. */
export function fromSystemMicros(sysMicros: bigint, ts: TimeSystemDef): number {
  const offsetMicros = BigInt(ts.utcOffsetMinutes) * 60n * 1_000_000n;
  if (ts.kind === "LINEAR_OFFSET") {
    const utcMicros = sysMicros + ts.epochMicros - offsetMicros;
    return Number(utcMicros / 1000n);
  }
  const unitMicros = BigInt(ts.unitSeconds) * 1_000_000n;
  const siMicros = divRound(sysMicros * unitMicros, DAY_MICROS) - offsetMicros + ts.epochMicros;
  return Number(siMicros / 1000n);
}

/** sol (or moon-day) index + wall time of a UTC instant under the system frame. */
export function systemDayOf(utcMs: number, ts: TimeSystemDef): { day: number; minuteOfDay: number } {
  const wall = toSystemMicros(utcMs, ts);
  const day = Math.floor(Number(divRound(wall, DAY_MICROS)));
  const within = wall - BigInt(day) * DAY_MICROS;
  const sec = Number(within / 1_000_000n);
  return { day, minuteOfDay: Math.floor(sec / 60) };
}

/** Format a Date in a time system as "sol 1234 · 09:00" or "HH:MM". */
export function formatInSystem(utcDate: Date, ts: TimeSystemDef, label = "day"): string {
  if (ts.kind === "LINEAR_OFFSET") {
    const micros = toSystemMicros(utcDate.getTime(), ts);
    const totalSec = Math.floor(Number(micros / 1000n) / 1000);
    const secs = ((totalSec % 86400) + 86400) % 86400;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const { day, minuteOfDay } = systemDayOf(utcDate.getTime(), ts);
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${label} ${day} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
