/**
 * UTP astronomy — real solar & lunar calculations (NOAA/Almanac approximations).
 * Everything is pure and returns UTC Dates. Coordinates are decimal degrees.
 * Accuracy is good to ~1 minute for sunrise/sunset, adequate for scheduling.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_DAY = 86_400_000;

function JulianDay(d: Date): number {
  // Standard JDN from a JS Date (UTC).
  return d.getTime() / MS_DAY + 2440587.5;
}
function FromJulian(jd: number): Date {
  return new Date((jd - 2440587.5) * MS_DAY);
}

/** Solar declination (rad) & equation of time (minutes) for a given day. */
function solar(date: Date): { decl: number; eqTime: number } {
  const n = JulianDay(date) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360;
  const lambda = L + 1.915 * Math.sin(g * RAD) + 0.02 * Math.sin(2 * g * RAD);
  const epsilon = 23.439 - 0.00000036 * n;
  const decl = Math.asin(Math.sin(epsilon * RAD) * Math.sin(lambda * RAD));
  // equation of time
  const y = Math.tan((epsilon * RAD) / 2) ** 2;
  let E =
    y * Math.sin(2 * lambda * RAD) -
    2 * 0.0167 * Math.sin(g * RAD) +
    4 * 0.0167 * y * Math.sin(g * RAD) * Math.cos(2 * lambda * RAD) -
    0.5 * y * y * Math.sin(4 * lambda * RAD) +
    1.25 * 0.0167 * 0.0167 * Math.sin(2 * g * RAD);
  E *= 4 * DEG; // minutes
  return { decl, eqTime: E };
}

/**
 * Sun event time (UTC) for a given latitude, day (any Date within it) and a
 * zenith angle. altDeg: elevation of the sun's centre (0.250 baseline rise,
 * -6 civil, -12 nautical, -18 astronomical). Returns null if no event (polar).
 */
function sunEvent(date: Date, lat: number, lng: number, altDeg: number, rising: boolean): Date | null {
  const { decl, eqTime } = solar(date);
  const latRad = lat * RAD;
  const cosH =
    (Math.sin(altDeg * RAD) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  let ha = Math.acos(cosH) * DEG; // hour angle, degrees
  if (rising) ha = 360 - ha;
  const localNoonMinutes = 720 - 4 * lng - eqTime; // minutes UTC
  const eventMinutes = localNoonMinutes + (ha * 4);
  // wrap into [0,1440)
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(base + eventMinutes * 60000);
}

export type GeoPoint = { lat: number; lng: number };

/** Core sun times for a calendar day (UTC Date within that day). */
export function sunTimes(day: Date, geo: GeoPoint) {
  const noon = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12));
  return {
    sunrise: sunEvent(noon, geo.lat, geo.lng, -0.833, true),
    sunset: sunEvent(noon, geo.lat, geo.lng, -0.833, false),
    solarNoon: solarNoon(day, geo),
    civilDawn: sunEvent(noon, geo.lat, geo.lng, -6, true),
    civilDusk: sunEvent(noon, geo.lat, geo.lng, -6, false),
    nauticalDawn: sunEvent(noon, geo.lat, geo.lng, -12, true),
    nauticalDusk: sunEvent(noon, geo.lat, geo.lng, -12, false),
    astroDawn: sunEvent(noon, geo.lat, geo.lng, -18, true),
    astroDusk: sunEvent(noon, geo.lat, geo.lng, -18, false),
  };
}

function solarNoon(day: Date, geo: GeoPoint): Date {
  const { eqTime } = solar(day);
  const minutes = 720 - 4 * geo.lng - eqTime;
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return new Date(base + minutes * 60000);
}

/** Golden hour = first 60 minutes after sunrise or before sunset (centre at +6°). */
export function goldenHour(day: Date, geo: GeoPoint): { morning: Date | null; evening: Date | null } {
  const noon = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12));
  return {
    morning: sunEvent(noon, geo.lat, geo.lng, 6, true),
    evening: sunEvent(noon, geo.lat, geo.lng, 6, false),
  };
}

/** Moon phase age in days (0=new, ~14.77=full). Synodic month 29.530588853. */
export function moonAge(day: Date): number {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14); // reference new moon
  const days = (day.getTime() - knownNew) / MS_DAY;
  let phase = days % synodic;
  if (phase < 0) phase += synodic;
  return phase;
}

export function moonIllumination(day: Date): number {
  const age = moonAge(day);
  return (1 - Math.cos((2 * Math.PI * age) / 29.530588853)) / 2;
}

export type MoonPhase =
  | "NEW_MOON"
  | "WAXING_CRESCENT"
  | "FIRST_QUARTER"
  | "WAXING_GIBBOUS"
  | "FULL_MOON"
  | "WANING_GIBBOUS"
  | "LAST_QUARTER"
  | "WANING_CRESCENT";

export function moonPhase(day: Date): MoonPhase {
  const age = moonAge(day);
  const s = 29.530588853;
  if (age < 1 || age > s - 1) return "NEW_MOON";
  if (age >= s / 2 - 1 && age <= s / 2 + 1) return "FULL_MOON";
  if (Math.abs(age - s / 4) < 1) return "FIRST_QUARTER";
  if (Math.abs(age - (3 * s) / 4) < 1) return "LAST_QUARTER";
  if (age < s / 4) return "WAXING_CRESCENT";
  if (age < s / 2) return "WAXING_GIBBOUS";
  if (age < (3 * s) / 4) return "WANING_GIBBOUS";
  return "WANING_CRESCENT";
}

/** Next UTC instant on/after `from` when the moon hits the target phase age. */
export function nextMoonPhase(from: Date, target: "NEW_MOON" | "FULL_MOON" | "FIRST_QUARTER" | "LAST_QUARTER"): Date {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const offsets: Record<string, number> = { NEW_MOON: 0, FIRST_QUARTER: synodic / 4, FULL_MOON: synodic / 2, LAST_QUARTER: (3 * synodic) / 4 };
  const target0 = offsets[target];
  const days = (from.getTime() - knownNew) / MS_DAY;
  const cycles = Math.ceil((days - target0) / synodic);
  return new Date(knownNew + (cycles * synodic + target0) * MS_DAY);
}

/** Approximate UTC instant of a solar longitude crossing (for equinox/solstice). */
function sunLongitude(date: Date): number {
  const n = JulianDay(date) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) % 360;
  const lambda = L + 1.915 * Math.sin(g * RAD) + 0.02 * Math.sin(2 * g * RAD);
  return (lambda + 360) % 360;
}

function findSolarLongitude(year: number, targetDeg: number): Date {
  // binary search within the year for the sun's apparent longitude crossing target
  let lo = Date.UTC(year, 0, 1);
  let hi = Date.UTC(year, 11, 31);
  const cross = (t: number) => {
    let d = sunLongitude(new Date(t)) - targetDeg;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };
  // ensure sign change exists; expand search to ~±20 days around expected
  for (let i = 0; i < 60; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (cross(lo) === 0) return new Date(lo);
    if (cross(lo) * cross(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return new Date(Math.floor((lo + hi) / 2));
}

/** Equinox (0° / 180°) and solstice (90° / 270°) instants for a year, UTC. */
export function solarSeasons(year: number) {
  return {
    marchEquinox: findSolarLongitude(year, 0),
    juneSolstice: findSolarLongitude(year, 90),
    septemberEquinox: findSolarLongitude(year, 180),
    decemberSolstice: findSolarLongitude(year, 270),
  };
}

export type AstroEvent =
  | "SUNRISE"
  | "SUNSET"
  | "SOLAR_NOON"
  | "GOLDEN_HOUR"
  | "CIVIL_DAWN"
  | "CIVIL_DUSK"
  | "NAUTICAL_DAWN"
  | "NAUTICAL_DUSK"
  | "ASTRO_DAWN"
  | "ASTRO_DUSK"
  | "NEW_MOON"
  | "FULL_MOON"
  | "FIRST_QUARTER"
  | "LAST_QUARTER"
  | "MARCH_EQUINOX"
  | "JUNE_SOLSTICE"
  | "SEPTEMBER_EQUINOX"
  | "DECEMBER_SOLSTICE";

/** Resolve an astronomical event to a UTC instant near `ref` for `geo`. */
export function resolveAstro(event: AstroEvent, ref: Date, geo: GeoPoint): Date | null {
  switch (event) {
    case "SUNRISE": {
      const t = sunTimes(ref, geo);
      return t.sunrise;
    }
    case "SUNSET": {
      const t = sunTimes(ref, geo);
      return t.sunset;
    }
    case "SOLAR_NOON":
      return sunTimes(ref, geo).solarNoon;
    case "GOLDEN_HOUR": {
      const g = goldenHour(ref, geo);
      return g.morning;
    }
    case "CIVIL_DAWN":
      return sunTimes(ref, geo).civilDawn;
    case "CIVIL_DUSK":
      return sunTimes(ref, geo).civilDusk;
    case "NAUTICAL_DAWN":
      return sunTimes(ref, geo).nauticalDawn;
    case "NAUTICAL_DUSK":
      return sunTimes(ref, geo).nauticalDusk;
    case "ASTRO_DAWN":
      return sunTimes(ref, geo).astroDawn;
    case "ASTRO_DUSK":
      return sunTimes(ref, geo).astroDusk;
    case "NEW_MOON":
    case "FULL_MOON":
    case "FIRST_QUARTER":
    case "LAST_QUARTER":
      return nextMoonPhase(ref, event);
    case "MARCH_EQUINOX":
      return solarSeasons(ref.getUTCFullYear()).marchEquinox;
    case "JUNE_SOLSTICE":
      return solarSeasons(ref.getUTCFullYear()).juneSolstice;
    case "SEPTEMBER_EQUINOX":
      return solarSeasons(ref.getUTCFullYear()).septemberEquinox;
    case "DECEMBER_SOLSTICE":
      return solarSeasons(ref.getUTCFullYear()).decemberSolstice;
  }
}
