/**
 * Zone-local wall time <-> UTC conversion using Intl (no external deps).
 * Accurate for modern IANA zones (handles DST via two-pass offset check).
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function partsIn(date: Date, tz: string) {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, fmt);
  }
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(date)) {
    if (x.type !== "literal") p[x.type] = Number(x.value);
  }
  if (p.hour === 24) p.hour = 0;
  return p;
}

/** Offset (ms) of zone at the given instant: utc = wall - offset. */
export function zoneOffsetMs(utcDate: Date, tz: string): number {
  try {
    const p = partsIn(utcDate, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
    return asUtc - Math.floor(utcDate.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Interpret wall-clock parts in tz → UTC Date. */
export function wallToUtc(tz: string, year: number, month: number, day: number, h = 0, m = 0, s = 0): Date {
  const guess = Date.UTC(year, month - 1, day, h, m, s);
  // correct for zone offset at the guessed instant, then re-verify
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  const off2 = zoneOffsetMs(new Date(ts), tz);
  const corrected = guess - off2;
  if (corrected !== ts) ts = corrected; // DST edge
  return new Date(ts);
}

/** UTC Date → wall parts in tz. */
export function utcToWall(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number } {
  try {
    const p = partsIn(date, tz);
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second ?? 0, dow };
  } catch {
    return { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(), h: date.getUTCHours(), mi: date.getUTCMinutes(), s: date.getUTCSeconds(), dow: date.getUTCDay() };
  }
}
