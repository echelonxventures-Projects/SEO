/**
 * UTP seed — global temporal reference data (time systems, business rules,
 * holiday calendars, fiscal calendars, library templates) is ALWAYS seeded;
 * the demo workspace's calendars/patterns/events/appointments/workforce data
 * only under the demo guard, like every other demo module. Idempotent.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "node:crypto";
import { encryptSecret } from "../src/server/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const TIME_SYSTEMS = [
  { code: "UTC", name: "Coordinated Universal Time", kind: "LINEAR_OFFSET" as const, utcOffsetMinutes: 0, unitSeconds: 86400, label: "UTC" },
  { code: "IST", name: "India Standard Time", kind: "LINEAR_OFFSET" as const, utcOffsetMinutes: 330, unitSeconds: 86400, label: "IST" },
  { code: "US-EASTERN", name: "US Eastern (fixed −5h)", kind: "LINEAR_OFFSET" as const, utcOffsetMinutes: -300, unitSeconds: 86400, label: "ET" },
  { code: "MARS_SOL", name: "Mars Sol Coordinated (MTC)", kind: "ROTATION" as const, utcOffsetMinutes: 0, unitSeconds: 88775, epochIso: "1975-04-20T00:00:00Z", label: "sol" },
  { code: "MOON_TIME", name: "Lunar Cycle Time", kind: "ROTATION" as const, utcOffsetMinutes: 0, unitSeconds: 2551443, epochIso: "2000-01-06T18:14:00Z", label: "lune" },
];

const GLOBAL_RULES = [
  {
    code: "BH-STD-9-18", name: "Standard business hours 09:00–18:00", type: "BUSINESS_HOURS" as const, hard: true, priority: 10,
    params: { timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5], windows: [{ start: "09:00", end: "18:00" }] },
  },
  {
    code: "BH-24X7", name: "Always-open (24×7) window", type: "BUSINESS_HOURS" as const, hard: true, priority: 10,
    params: { timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "23:59" }] },
  },
  {
    code: "WD-MON-FRI", name: "Working days Mon–Fri", type: "WORKING_DAYS" as const, hard: true, priority: 20,
    params: { days: [1, 2, 3, 4, 5] },
  },
  {
    code: "CMP-2H-NOTICE", name: "Compliance: 2-hour minimum notice", type: "COMPLIANCE" as const, hard: false, priority: 30,
    params: { minNoticeHours: 2 },
  },
];

const GLOBAL_HOLIDAYS = [
  {
    code: "IN-REPUBLIC", name: "India National Days", country: "IN",
    entries: [
      { date: "2026-01-26", name: "Republic Day", recurringAnnual: true },
      { date: "2026-08-15", name: "Independence Day", recurringAnnual: true },
      { date: "2026-10-02", name: "Gandhi Jayanti", recurringAnnual: true },
      { date: "2026-11-08", name: "Diwali 2026", recurringAnnual: false },
      { date: "2027-10-28", name: "Diwali 2027", recurringAnnual: false },
    ],
  },
  {
    code: "US-FEDERAL", name: "US Federal Holidays", country: "US",
    entries: [
      { date: "2026-01-01", name: "New Year's Day", recurringAnnual: true },
      { date: "2026-07-04", name: "Independence Day", recurringAnnual: true },
      { date: "2026-11-26", name: "Thanksgiving", recurringAnnual: false },
      { date: "2026-12-25", name: "Christmas", recurringAnnual: true },
    ],
  },
];

const GLOBAL_FISCAL = [
  { code: "FY-IN", name: "Indian Financial Year (Apr–Mar)", anchorMonth: 4, startDay: 1, period: "QUARTERLY" as const },
  { code: "FY-US", name: "US Federal FY (Oct–Sep)", anchorMonth: 10, startDay: 1, period: "QUARTERLY" as const },
  { code: "FY-COSMIC", name: "Calendar-aligned retail (Jan–Dec, 13×4)", anchorMonth: 1, startDay: 1, period: "WEEKLY_13" as const },
];

const LIBRARY = [
  {
    code: "business-hours-standard", kind: "BUSINESS_HOURS" as const, name: "Standard 9–6 business hours", industry: "generic",
    description: "Mon–Fri 09:00–18:00 with holiday exclusion.",
    template: {
      patterns: [{ name: "9–6 weekdays", dsl: "EVERY WEEKDAY 09:00 FOR 9 HOURS", type: "WINDOW" }],
      rules: [{ name: "9–6 window", type: "BUSINESS_HOURS", params: { days: [1, 2, 3, 4, 5], windows: [{ start: "09:00", end: "18:00" }] }, hard: true }],
    },
  },
  {
    code: "trading-hours-market", kind: "TRADING_HOURS" as const, name: "Market trading hours 10:00–16:00", industry: "finance",
    description: "Exchange-style trading window on weekdays.",
    template: { patterns: [{ name: "Trading day", dsl: "EVERY WEEKDAY 10:00 FOR 6 HOURS", type: "WINDOW" }] },
  },
  {
    code: "office-hours-9-5", kind: "OFFICE_HOURS" as const, name: "Classic office 9–5", industry: "generic",
    description: "Mon–Fri 09:00–17:00.",
    template: { patterns: [{ name: "Office day", dsl: "EVERY WEEKDAY 09:00 FOR 8 HOURS", type: "WINDOW" }] },
  },
  {
    code: "fiscal-calendar-pack", kind: "FISCAL_CALENDAR" as const, name: "Fiscal calendars (IN/US)", industry: "finance",
    description: "Instantiates Indian and US fiscal calendars.",
    template: { fiscal: { code: "FY-IN-STD", name: "FY Apr–Mar", anchorMonth: 4, period: "QUARTERLY" } },
  },
  {
    code: "holiday-pack-india", kind: "HOLIDAY_CALENDAR" as const, name: "India national holidays", industry: "generic",
    description: "Republic Day, Independence, Gandhi Jayanti (annual) + Diwali 2026/27.",
    template: {
      holidayCalendar: {
        code: "IN-NATIONAL", name: "India National Days",
        entries: [
          { date: "2026-01-26", name: "Republic Day", recurringAnnual: true },
          { date: "2026-08-15", name: "Independence Day", recurringAnnual: true },
          { date: "2026-10-02", name: "Gandhi Jayanti", recurringAnnual: true },
        ],
      },
    },
  },
  {
    code: "maintenance-sun-2am", kind: "MAINTENANCE_WINDOW" as const, name: "Sunday 02:00 maintenance window", industry: "tech",
    description: "Weekly 3-hour maintenance window.",
    template: { patterns: [{ name: "Sunday window", dsl: "EVERY SUNDAY 02:00 FOR 3 HOURS", type: "WINDOW" }] },
  },
  {
    code: "shift-3-rotation", kind: "SHIFT_TEMPLATE" as const, name: "3-shift rotation (Day/Evening/Night)", industry: "manufacturing",
    description: "Classic factory rotation set.",
    template: {
      shifts: [
        { name: "Day", startTime: "06:00", endTime: "14:00", kind: "FIXED", color: "#f59e0b" },
        { name: "Evening", startTime: "14:00", endTime: "22:00", kind: "FIXED", color: "#0ea5e9" },
        { name: "Night", startTime: "22:00", endTime: "06:00", crossDay: true, kind: "FIXED", color: "#6366f1" },
      ],
    },
  },
  {
    code: "industry-clinic", kind: "INDUSTRY" as const, name: "Medical clinic pack", industry: "healthcare",
    description: "Clinic hours + appointment pattern + emergency rule.",
    template: {
      patterns: [
        { name: "Clinic hours", dsl: "EVERY WEEKDAY 09:00 FOR 8 HOURS", type: "WINDOW" },
        { name: "Saturday half-day", dsl: "EVERY SATURDAY 09:00 FOR 4 HOURS", type: "WINDOW" },
      ],
      rules: [{ name: "No after-hours", type: "BUSINESS_HOURS", params: { days: [1, 2, 3, 4, 5, 6], windows: [{ start: "09:00", end: "17:00" }] }, hard: true }],
    },
  },
  {
    code: "industry-restaurant", kind: "INDUSTRY" as const, name: "Restaurant service pack", industry: "hospitality",
    description: "Lunch & dinner sittings, every-day operation.",
    template: {
      patterns: [
        { name: "Lunch sitting", dsl: "EVERY DAY 12:00 FOR 4 HOURS", type: "WINDOW" },
        { name: "Dinner sitting", dsl: "EVERY DAY 19:00 FOR 4 HOURS", type: "WINDOW" },
      ],
    },
  },
  {
    code: "industry-dev-agency", kind: "INDUSTRY" as const, name: "Digital agency pack", industry: "saas",
    description: "Standups, fortnightly reviews, monthly retros.",
    template: {
      patterns: [
        { name: "Daily standup", dsl: "EVERY WEEKDAY 09:30 FOR 30 MINUTES", type: "WINDOW" },
        { name: "Fortnightly review", dsl: "EVERY 14 DAYS 15:00 FOR 1 HOURS", type: "WINDOW" },
        { name: "Monthly retro", dsl: "LAST FRIDAY OF MONTH 16:00", type: "WINDOW" },
      ],
    },
  },
  {
    code: "enterprise-24x7", kind: "ENTERPRISE" as const, name: "24×7 enterprise calendar", industry: "generic",
    description: "Always-on availability with 5-min micro-windows.",
    template: {
      patterns: [{ name: "24x7", dsl: "EVERY DAY 00:00 FOR 24 HOURS", type: "WINDOW" }],
      rules: [{ name: "24x7 window", type: "BUSINESS_HOURS", params: { days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "23:59" }] }, hard: true }],
    },
  },
];

export async function seedTemporalGlobals() {
  for (const ts of TIME_SYSTEMS) {
    const existing = await db.timeSystem.findFirst({ where: { orgId: null, code: ts.code } });
    if (existing) continue;
    await db.timeSystem.create({
      data: {
        orgId: null,
        code: ts.code,
        name: ts.name,
        kind: ts.kind,
        utcOffsetMinutes: ts.utcOffsetMinutes,
        unitSeconds: ts.unitSeconds,
        epochMicros: ts.epochIso ? BigInt(new Date(ts.epochIso).getTime()) * 1000n : 0n,
        label: ts.label,
      },
    });
  }

  for (const r of GLOBAL_RULES) {
    const existing = await db.temporalRule.findFirst({ where: { orgId: null, name: r.name } });
    if (existing) continue;
    await db.temporalRule.create({
      data: { orgId: null, name: r.name, type: r.type as never, params: r.params as object, hard: r.hard, priority: r.priority, isLibrary: true, createdById: "seed" },
    });
  }

  for (const hc of GLOBAL_HOLIDAYS) {
    const existing = await db.holidayCalendar.findFirst({ where: { orgId: null, code: hc.code } });
    if (existing) continue;
    await db.holidayCalendar.create({
      data: {
        orgId: null,
        code: hc.code,
        name: hc.name,
        country: hc.country,
        scope: "GLOBAL",
        createdById: "seed",
        entries: { create: hc.entries.map((e) => ({ orgId: null, date: new Date(`${e.date}T00:00:00Z`), name: e.name, recurringAnnual: e.recurringAnnual })) },
      },
    });
  }

  for (const fc of GLOBAL_FISCAL) {
    const existing = await db.fiscalCalendar.findFirst({ where: { orgId: null, code: fc.code } });
    if (existing) continue;
    await db.fiscalCalendar.create({ data: { orgId: null, code: fc.code, name: fc.name, anchorMonth: fc.anchorMonth, startDay: fc.startDay, period: fc.period as never } });
  }

  for (const t of LIBRARY) {
    const existing = await db.libraryTemplate.findFirst({ where: { orgId: null, code: t.code } });
    if (existing) {
      await db.libraryTemplate.update({ where: { id: existing.id }, data: { kind: t.kind as never, name: t.name, industry: t.industry, description: t.description, template: t.template as object, isGlobal: true } });
      continue;
    }
    await db.libraryTemplate.create({
      data: { orgId: null, code: t.code, kind: t.kind as never, name: t.name, industry: t.industry, description: t.description, template: t.template as object, isGlobal: true },
    });
  }
  // remaining Universal Temporal Library kinds (the full 21-kind catalog)
  const EXTRA_LIBRARY = [
    { code: "booking-slot-30", kind: "BOOKING", name: "30-minute booking slots", industry: "generic", description: "Half-hour bookable slots during business hours.",
      template: { patterns: [{ name: "30-min slot window", dsl: "EVERY WEEKDAY 09:00 FOR 8 HOURS", type: "WINDOW" }], booking: { slotMinutes: 30, durationMinutes: 30, bufferMinutes: 5 } } },
    { code: "booking-slot-60", kind: "BOOKING", name: "60-minute consultation slots", industry: "professional", description: "Hour-long consultations.",
      template: { patterns: [{ name: "1-hour slot window", dsl: "EVERY WEEKDAY 09:00 FOR 8 HOURS", type: "WINDOW" }], booking: { slotMinutes: 60, durationMinutes: 60, bufferMinutes: 10 } } },
    { code: "workflow-onboarding", kind: "WORKFLOW", name: "Client onboarding workflow", industry: "saas", description: "Day 0 welcome, day 1 kickoff, day 7 check-in.",
      template: { patterns: [{ name: "Onboarding day 0", dsl: "EVERY WEEKDAY 09:00", type: "WINDOW" }, { name: "Week-1 check-in", dsl: "EVERY 7 DAYS 10:00", type: "WINDOW" }], workflow: { steps: ["welcome", "kickoff", "check-in"] } } },
    { code: "automation-daily-digest", kind: "AUTOMATION", name: "Daily operations digest", industry: "generic", description: "One digest per weekday morning.",
      template: { patterns: [{ name: "Daily digest", dsl: "EVERY WEEKDAY 08:00", type: "WINDOW" }], automation: { consumer: "NOTIFICATION" } } },
    { code: "compliance-gdpr-hold", kind: "COMPLIANCE", name: "GDPR data retention hold", industry: "generic", description: "Retention window + audit hold.",
      template: { rules: [{ name: "GDPR retention", type: "CUSTOM", params: { maxMinutes: 0, retentionDays: 730 }, hard: false }] } },
    { code: "compliance-soc2", kind: "COMPLIANCE", name: "SOC2 change windows", industry: "tech", description: "Changes only inside approved windows.",
      template: { rules: [{ name: "Change window", type: "BUSINESS_HOURS", params: { days: [1, 2, 3, 4, 5], windows: [{ start: "10:00", end: "16:00" }] }, hard: true }] } },
    { code: "launch-t-minus", kind: "LAUNCH", name: "Product launch T-minus plan", industry: "saas", description: "T-7, T-1, T-0, T+1 milestones.",
      template: { patterns: [{ name: "Launch eve check", dsl: "EVERY WEEKDAY 16:00", type: "WINDOW" }], launch: { milestones: ["T-7", "T-1", "T-0", "T+1"] } } },
    { code: "support-window-24x5", kind: "SUPPORT_WINDOW", name: "24×5 support window", industry: "generic", description: "Mon–Fri round-the-clock support cover.",
      template: { patterns: [{ name: "24x5 cover", dsl: "EVERY WEEKDAY 00:00 FOR 24 HOURS", type: "WINDOW" }] } },
    { code: "peak-window-holiday", kind: "PEAK_WINDOW", name: "Holiday peak window", industry: "retail", description: "Peak trading weeks around the holidays.",
      template: { patterns: [{ name: "Peak day", dsl: "EVERY DAY 08:00 FOR 14 HOURS", type: "WINDOW" }] } },
    { code: "capacity-model-seats", kind: "CAPACITY_MODEL", name: "Seat-based capacity model", industry: "generic", description: "Capacity = concurrent seats.",
      template: { capacity: { model: "SEATS", defaultCapacity: 10, overbook: false } } },
    { code: "availability-model-shift", kind: "AVAILABILITY_MODEL", name: "Shift-based availability model", industry: "hospitality", description: "Availability derived from shift roster.",
      template: { patterns: [{ name: "Shift cover", dsl: "EVERY DAY 06:00 FOR 16 HOURS", type: "WINDOW" }], availability: { model: "SHIFT_DERIVED" } } },
    { code: "ai-template-brief", kind: "AI_TEMPLATE", name: "Campaign brief generator", industry: "generic", description: "AI brief prompt template for campaigns.",
      template: { ai: { prompt: "Write a concise campaign brief for {{topic}} targeting {{audience}}.", capability: "text" } } },
    { code: "department-engineering", kind: "DEPARTMENT", name: "Engineering department calendar", industry: "tech", description: "Sprint cadence + on-call rotation.",
      template: { patterns: [{ name: "Sprint planning", dsl: "EVERY 14 DAYS 10:00", type: "WINDOW" }, { name: "On-call handover", dsl: "EVERY MONDAY 09:00", type: "WINDOW" }] } },
    { code: "resource-template-fleet", kind: "RESOURCE_TEMPLATE", name: "Fleet resource template", industry: "logistics", description: "Vehicle resources with capacity 1.",
      template: { resources: [{ type: "VEHICLE", capacity: 1, requiresApproval: false }] } },
  ];
  for (const t of EXTRA_LIBRARY) {
    const existing = await db.libraryTemplate.findFirst({ where: { orgId: null, code: t.code } });
    if (existing) continue;
    await db.libraryTemplate.create({ data: { orgId: null, code: t.code, kind: t.kind as never, name: t.name, industry: t.industry, description: t.description, template: t.template as object, isGlobal: true } });
  }

  // fill-in-the-blank placeholder: platform event-stream fabric (inactive until a sink is pasted in)
  const placeholder = await db.streamTransport.findFirst({ where: { orgId: null, name: "Platform event fabric" } });
  if (!placeholder) {
    const secret = `tsec_${crypto.randomBytes(24).toString("base64url")}`;
    const t = await db.streamTransport.create({
      data: { orgId: null, name: "Platform event fabric", kind: "HTTP_SINK", url: "https://REPLACE-ME.example/temporal-events", eventMatch: "*", secretEnc: encryptSecret(secret, "stream:pending"), active: false, createdById: "seed" },
    });
    await db.streamTransport.update({ where: { id: t.id }, data: { secretEnc: encryptSecret(secret, `stream:${t.id}`) } });
  }
  // external calendar connector templates (platform library — platforms as data)
  const CONNECTORS = [
    { key: "google-calendar", name: "Google Calendar", protocol: "GOOGLE_CALENDAR", config: { authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", eventsPath: "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?timeMin={timeMin}&timeMax={timeMax}&singleEvents=true", scope: "https://www.googleapis.com/auth/calendar", supportsPush: true, supportsPull: true, defaultTimezone: "UTC" } },
    { key: "microsoft-graph", name: "Outlook / Office 365", protocol: "MICROSOFT_GRAPH", config: { authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", eventsPath: "https://graph.microsoft.com/v1.0/me/calendars/{calendarId}/calendarView?startDateTime={timeMin}&endDateTime={timeMax}", scope: "Calendars.ReadWrite", supportsPush: true, supportsPull: true, defaultTimezone: "UTC" } },
    { key: "caldav", name: "CalDAV (Apple/Nextcloud/Fastmail)", protocol: "CALDAV", config: { caldavPath: "", supportsPush: true, supportsPull: true, defaultTimezone: "UTC" } },
    { key: "ical-subscribe", name: "iCal subscribe (.ics URL)", protocol: "ICAL_SUBSCRIBE", config: { supportsPush: false, supportsPull: true, defaultTimezone: "UTC" } },
    { key: "generic-rest", name: "Generic REST calendar", protocol: "GENERIC_REST", config: { eventsPath: "", supportsPush: false, supportsPull: true, defaultTimezone: "UTC" } },
  ];
  for (const c of CONNECTORS) {
    const existing = await db.calendarConnectorTemplate.findFirst({ where: { orgId: null, key: c.key } });
    if (!existing) {
      await db.calendarConnectorTemplate.create({ data: { orgId: null, key: c.key, name: c.name, protocol: c.protocol as never, config: c.config as object } });
    }
  }

  // platform locale catalogs (i18n baseline — workspaces may override per string)
  const LOCALES = [
    { code: "en-IN", name: "English (India)", nativeName: "English", direction: "ltr", isDefault: true, strings: { "nav.dashboard": "Dashboard", "nav.calendar": "Calendars", "action.book": "Book", "action.cancel": "Cancel" } },
    { code: "hi", name: "Hindi", nativeName: "हिन्दी", direction: "ltr", isDefault: false, strings: { "nav.dashboard": "डैशबोर्ड", "nav.calendar": "कैलेंडर", "action.book": "बुक करें", "action.cancel": "रद्द करें" } },
    { code: "ar", name: "Arabic", nativeName: "العربية", direction: "rtl", isDefault: false, strings: { "nav.dashboard": "لوحة التحكم", "nav.calendar": "التقاويم", "action.book": "احجز", "action.cancel": "إلغاء" } },
  ];
  for (const l of LOCALES) {
    const existing = await db.localeCatalog.findFirst({ where: { orgId: null, code: l.code } });
    if (!existing) {
      await db.localeCatalog.create({ data: { orgId: null, code: l.code, name: l.name, nativeName: l.nativeName, direction: l.direction, strings: l.strings as object, isDefault: l.isDefault } });
    }
  }

  console.log(`  UTP globals: ${TIME_SYSTEMS.length} time systems · ${GLOBAL_RULES.length} rules · ${GLOBAL_HOLIDAYS.length} holiday calendars · ${GLOBAL_FISCAL.length} fiscal · ${LIBRARY.length} library templates · ${CONNECTORS.length} connectors · ${LOCALES.length} locales · 1 stream placeholder`);
}

// ---------------------------------------------------------------------------
// demo workspace
// ---------------------------------------------------------------------------

function iso(daysFromNow: number, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}

export async function seedTemporalWorkspace(orgId: string, userId: string) {
  // configuration
  await db.temporalConfiguration.upsert({
    where: { orgId },
    create: { orgId, timezone: "Asia/Kolkata", timeSystemCode: "UTC", weekStartsOn: 1, workingDays: [1, 2, 3, 4, 5], materializeHorizonDays: 90, retentionDays: 0, defaultCapacity: 1, settings: {} },
    update: {},
  });

  // calendars
  async function ensureCalendar(code: string, name: string, kind: string, patternId?: string | null) {
    const existing = await db.calendar.findFirst({ where: { orgId, code } });
    if (existing) return existing;
    return db.calendar.create({
      data: { orgId, code, name, kind: kind as never, visibility: "INTERNAL", timezone: "Asia/Kolkata", ownerUserId: userId, createdById: userId, patternId: patternId ?? null, color: kind === "RESOURCE" ? "#059669" : "#6366f1" },
    });
  }

  async function ensurePattern(name: string, dsl: string, type: string, extraSpec?: object) {
    const existing = await db.temporalPattern.findFirst({ where: { orgId, name } });
    if (existing) return existing;
    return db.temporalPattern.create({
      data: { orgId, name, type: type as never, freq: "CUSTOM" as never, dsl, spec: { freq: "DAILY", interval: 1, time: "09:00", ...extraSpec }, createdById: userId },
    });
  }

  const standup = await db.temporalPattern.findFirst({ where: { orgId, name: "Daily standup" } })
    ?? await db.temporalPattern.create({ data: { orgId, name: "Daily standup", type: "WINDOW", freq: "DAILY", dsl: "EVERY WEEKDAY 09:30 FOR 30 MINUTES", spec: { freq: "DAILY", interval: 1, time: "09:30", durationMinutes: 30, byBusinessDay: true }, createdById: userId } });
  const review = await db.temporalPattern.findFirst({ where: { orgId, name: "Fortnightly review" } })
    ?? await db.temporalPattern.create({ data: { orgId, name: "Fortnightly review", type: "WINDOW", freq: "DAILY", dsl: "EVERY 14 DAYS 15:00 FOR 1 HOURS", spec: { freq: "DAILY", interval: 14, time: "15:00", durationMinutes: 60 }, createdById: userId } });
  const retro = await db.temporalPattern.findFirst({ where: { orgId, name: "Monthly retro" } })
    ?? await db.temporalPattern.create({ data: { orgId, name: "Monthly retro", type: "WINDOW", freq: "CUSTOM", dsl: "LAST FRIDAY OF MONTH 16:00", spec: { freq: "MONTHLY", interval: 1, time: "16:00", durationMinutes: 45, setPos: -1, posWeekday: 5 }, createdById: userId } });
  const roomWindow = await db.temporalPattern.findFirst({ where: { orgId, name: "Boardroom window" } })
    ?? await db.temporalPattern.create({ data: { orgId, name: "Boardroom window", type: "WINDOW", freq: "DAILY", dsl: "EVERY WEEKDAY 09:00 FOR 9 HOURS", spec: { freq: "DAILY", interval: 1, time: "09:00", durationMinutes: 540, byBusinessDay: true }, createdById: userId } });
  void ensurePattern;

  const ops = await ensureCalendar("agency-ops", "Agency Ops", "TEAM", standup.id);
  const delivery = await ensureCalendar("client-delivery", "Client Delivery", "PROJECT");
  const roomCal = await ensureCalendar("boardroom", "Boardroom", "RESOURCE", roomWindow.id);
  await db.calendarShare.upsert({
    where: { calendarId_principalType_principalId: { calendarId: ops.id, principalType: "USER", principalId: userId } },
    create: { orgId, calendarId: ops.id, principalType: "USER", principalId: userId, permission: "MANAGE" },
    update: { permission: "MANAGE" },
  });

  // events
  const client = await db.client.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } });
  if (!(await db.scheduledEvent.findFirst({ where: { orgId, title: "Daily standup" } }))) {
    const start = new Date(iso(1, "04:00")); // 09:30 IST
    const ev = await db.scheduledEvent.create({
      data: {
        orgId, calendarId: ops.id, patternId: standup.id, type: "SERIES_MASTER", title: "Daily standup",
        startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000), timezone: "Asia/Kolkata",
        metadata: { auto: true }, createdById: userId,
      },
    });
    await db.$transaction(async (tx) => {
      const { materialize } = await import("../src/server/temporal/recurrence");
      const occ = materialize(standup.spec as never, start, new Date(Date.now() + 60 * 86_400_000), "Asia/Kolkata", { max: 40 });
      for (const o of occ) {
        await tx.eventOccurrence.create({ data: { orgId, eventId: ev.id, startsAt: o.startsAt, endsAt: o.endsAt } });
      }
    });
  }
  if (!(await db.scheduledEvent.findFirst({ where: { orgId, title: "Monthly retro" } }))) {
    const start = new Date(iso(18, "10:30"));
    const ev = await db.scheduledEvent.create({
      data: {
        orgId, calendarId: ops.id, patternId: retro.id, type: "SERIES_MASTER", title: "Monthly retro",
        startsAt: new Date(start.getTime() + (31 - start.getUTCDate()) * 86_400_000), endsAt: new Date(start.getTime() + 45 * 60_000), timezone: "Asia/Kolkata", createdById: userId,
      },
    });
    const { materialize } = await import("../src/server/temporal/recurrence");
    const occ = materialize(retro.spec as never, new Date(), new Date(Date.now() + 180 * 86_400_000), "Asia/Kolkata", { max: 12 });
    for (const o of occ) await db.eventOccurrence.create({ data: { orgId, eventId: ev.id, startsAt: o.startsAt, endsAt: o.endsAt } });
  }
  if (!(await db.scheduledEvent.findFirst({ where: { orgId, title: "Quarterly business review" } }))) {
    const start = new Date(iso(3, "10:00"));
    await db.scheduledEvent.create({
      data: {
        orgId, calendarId: delivery.id, type: "SINGLE", title: "Quarterly business review",
        description: "Client-facing QBR — prep deck, metrics, next quarter plan.",
        startsAt: start, endsAt: new Date(start.getTime() + 90 * 60_000), timezone: "Asia/Kolkata",
        location: "Client HQ", capacity: 10, clientRef: client?.id ?? null,
        metadata: { consumer: "CAMPAIGN" }, createdById: userId,
      },
    });
  }
  if (!(await db.scheduledEvent.findFirst({ where: { orgId, title: "Growth workshop" } }))) {
    const start = new Date(iso(5, "05:30")); // 11:00 IST
    await db.scheduledEvent.create({
      data: { orgId, calendarId: delivery.id, type: "SINGLE", title: "Growth workshop", startsAt: start, endsAt: new Date(start.getTime() + 2 * 3_600_000), timezone: "Asia/Kolkata", createdById: userId },
    });
  }

  // dependency QBR -> workshop (FS + 24h)
  const qbr = await db.scheduledEvent.findFirst({ where: { orgId, title: "Quarterly business review" } });
  const workshop = await db.scheduledEvent.findFirst({ where: { orgId, title: "Growth workshop" } });
  if (qbr && workshop && !(await db.temporalDependency.findFirst({ where: { orgId, fromId: qbr.id, toId: workshop.id } }))) {
    await db.temporalDependency.create({ data: { orgId, scope: "EVENT", fromType: "event", fromId: qbr.id, toType: "event", toId: workshop.id, type: "FINISH_TO_START", lagValue: 1440, lagUnit: "MINUTES" } });
  }

  // resources + bookings
  const resources = [
    { code: "boardroom", name: "Boardroom", type: "ROOM", capacity: 12 },
    { code: "van-01", name: "Company Van", type: "VEHICLE", capacity: 1 },
    { code: "rig-a", name: "Studio Rig A", type: "STUDIO", capacity: 1 },
    { code: "priya-camera", name: "Priya (Camera Op)", type: "HUMAN", capacity: 1 },
  ];
  for (const r of resources) {
    const existing = await db.resource.findFirst({ where: { orgId, code: r.code } });
    if (existing) continue;
    await db.resource.create({
      data: { orgId, code: r.code, name: r.name, type: r.type as never, capacity: r.capacity, availabilityPatternId: roomWindow.id, calendarId: r.code === "boardroom" ? roomCal.id : null, createdById: userId, metadata: r.type === "ROOM" ? { floor: "3rd", equipment: ["tv", "whiteboard"] } : {} },
    });
  }
  const boardroom = await db.resource.findFirst({ where: { orgId, code: "boardroom" } });
  if (boardroom && !(await db.resourceBooking.findFirst({ where: { resourceId: boardroom.id } }))) {
    const s = new Date(iso(1, "04:30"));
    await db.resourceBooking.create({ data: { orgId, resourceId: boardroom.id, startsAt: s, endsAt: new Date(s.getTime() + 60 * 60_000), status: "CONFIRMED" } });
  }

  // availability profile for the owner
  if (!(await db.availabilityProfile.findFirst({ where: { orgId, subjectType: "USER", subjectId: userId } }))) {
    await db.availabilityProfile.create({ data: { orgId, subjectType: "USER", subjectId: userId, patternId: roomWindow.id, timezone: "Asia/Kolkata", capacity: 2, createdById: userId } });
  }

  // slots + appointments + waitlist
  if (!(await db.appointmentSlot.findFirst({ where: { orgId, calendarId: roomCal.id } }))) {
    const base = new Date(iso(2, "04:00"));
    for (let i = 0; i < 4; i++) {
      const slotStart = new Date(base.getTime() + i * 30 * 60_000);
      const slot = await db.appointmentSlot.create({
        data: { orgId, calendarId: roomCal.id, resourceId: boardroom?.id ?? null, startsAt: slotStart, endsAt: new Date(slotStart.getTime() + 30 * 60_000), capacity: 1, status: i === 0 ? "BOOKED" : "OPEN", booked: i === 0 ? 1 : 0 },
      });
      if (i === 0) {
        const tz = roomCal.timezone ?? "Asia/Kolkata";
        await db.appointment.create({
          data: {
            orgId, calendarId: roomCal.id, resourceId: boardroom?.id ?? null, referenceCode: `BK-${slot.id.slice(-6).toUpperCase()}`,
            attendeeName: "Zenware Stakeholders", attendeeEmail: "ops@zenware.example", service: "QBR rehearsal", status: "CONFIRMED",
            startsAt: slotStart, endsAt: new Date(slotStart.getTime() + 30 * 60_000), timezone: tz,
            meta: { slotId: slot.id, source: "seed" } as object, createdById: userId,
          },
        });
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = new Date(iso(2, "04:00"));
      await db.appointment.create({
        data: {
          orgId, calendarId: roomCal.id, referenceCode: `BK-WL-${i + 1}-${slotHash()}`,
          attendeeName: i === 0 ? "Waiting Client A" : "Waiting Client B", service: "Room booking", status: "WAITLISTED", waitlistPos: i + 1,
          startsAt: s, endsAt: new Date(s.getTime() + 30 * 60_000), timezone: roomCal.timezone, meta: { source: "waitlist" } as object, createdById: userId,
        },
      });
    }
  }

  // workforce
  const shifts = [
    { code: "DAY", name: "Day", startTime: "09:00", endTime: "17:00", crossDay: false, color: "#f59e0b" },
    { code: "EVE", name: "Evening", startTime: "15:00", endTime: "23:00", crossDay: false, color: "#0ea5e9" },
    { code: "NGT", name: "Night", startTime: "22:00", endTime: "06:00", crossDay: true, color: "#6366f1" },
  ];
  const shiftRows: { id: string }[] = [];
  for (const sh of shifts) {
    let row = await db.shift.findFirst({ where: { orgId, code: sh.code } });
    if (!row) {
      row = await db.shift.create({ data: { orgId, code: sh.code, name: sh.name, kind: "FIXED", startTime: sh.startTime, endTime: sh.endTime, crossDay: sh.crossDay, color: sh.color, breakMinutes: 60, createdById: userId } });
    }
    shiftRows.push({ id: row.id });
  }
  if (!(await db.shiftAssignment.findFirst({ where: { orgId } }))) {
    const day = new Date();
    day.setUTCHours(3, 30); // 09:00 IST
    await db.shiftAssignment.create({ data: { orgId, shiftId: shiftRows[0].id, userId, startsAt: day, endsAt: new Date(day.getTime() + 8 * 3_600_000 - 3_600_000), role: "PRIMARY" } });
    await db.shiftAssignment.create({ data: { orgId, shiftId: shiftRows[1].id, userId, startsAt: new Date(day.getTime() + 6 * 86_400_000), endsAt: new Date(day.getTime() + 6 * 86_400_000 + 7 * 3_600_000), role: "PRIMARY" } });
  }
  if (!(await db.coverageRequirement.findFirst({ where: { orgId, dayOfWeek: 1 } }))) {
    for (let dow = 1; dow <= 5; dow++) {
      await db.coverageRequirement.create({ data: { orgId, dayOfWeek: dow, startTime: "09:00", endTime: "18:00", requiredCount: 2, timezone: "Asia/Kolkata" } });
    }
  }

  // triggers
  const calEvent = await db.scheduledEvent.findFirst({ where: { orgId, title: "Daily standup" } });
  if (!(await db.temporalTrigger.findFirst({ where: { orgId, name: "Standup reminder" } }))) {
    const at = new Date(Date.now() + 60 * 60_000);
    await db.temporalTrigger.create({
      data: {
        orgId, calendarId: ops.id, name: "Standup reminder", anchorType: "RELATIVE", anchor: { offsetMinutes: 60, email: "founder@aithink.india", subject: "Standup in 1 hour", projectId: (await db.project.findFirst({ where: { orgId }, select: { id: true } }))?.id ?? null, title: "Prep standup notes" },
        consumerType: "WORKFLOW", status: "ARMED", nextFireAt: at, retry: { maxAttempts: 3, backoffSeconds: 60 }, createdById: userId,
      },
    });
    await db.temporalTrigger.create({
      data: {
        orgId, calendarId: ops.id, name: "Sunrise social check", anchorType: "ASTRONOMICAL", anchor: { astroEvent: "SUNRISE", lat: 19.076, lng: 72.8777 },
        dsl: "AT SUNRISE", consumerType: "MONITORING", status: "ARMED", nextFireAt: new Date(Date.now() + 24 * 3_600_000), retry: { maxAttempts: 2, backoffSeconds: 300 }, createdById: userId,
      },
    });
    if (qbr && calEvent) {
      await db.temporalTrigger.create({
        data: {
          orgId, calendarId: delivery.id, name: "QBR kickoff reminder", anchorType: "EVENT_BEFORE", dsl: "BEFORE EVENT(LAUNCH)-2H", anchor: { offsetMinutes: 120, eventId: qbr.id },
          consumerType: "NOTIFICATION", status: "ARMED", retry: { maxAttempts: 3, backoffSeconds: 60 }, createdById: userId,
        },
      });
    }
  }

  // centralization at seed time: adopt every legacy flight cadence into a UTP asset
  const legacyFlights = (await db.campaignFlight.findMany({ where: { orgId, patternId: null }, take: 200 })).filter((f) => {
    const cad = f.cadence as { days?: number[] } | null;
    return Array.isArray(cad?.days) && cad.days.length > 0;
  });
  for (const f of legacyFlights) {
    const cad = f.cadence as { days: number[]; time?: string };
    const time = cad.time ?? "10:00";
    const spec = { freq: "WEEKLY", interval: 1, weekdays: [...cad.days].sort((a, b) => a - b), time, durationMinutes: 30 };
    const pattern = await db.temporalPattern.create({
      data: {
        orgId,
        name: `Flight cadence · ${f.channelId.slice(-6)}`,
        type: "WINDOW",
        freq: "WEEKLY",
        spec: spec as object,
        dsl: `EVERY ${[...cad.days].sort((a, b) => a - b).map((d) => ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d]).join("+")} ${time}`,
        timezone: f.timezone,
        createdById: userId,
      },
    });
    await db.campaignFlight.update({ where: { id: f.id }, data: { patternId: pattern.id } });
  }

  void ensureCalendar;
  console.log(`  UTP demo: calendars, patterns, series, resources, appointments, shifts, triggers seeded (${legacyFlights.length} flight cadences adopted)`);
}

function slotHash(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
