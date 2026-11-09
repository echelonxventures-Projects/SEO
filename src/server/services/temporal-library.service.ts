/**
 * UTP Governance API — versions, rollback, replay, time-travel, event-log
 * queries. Plus the Temporal Library: reusable rules/holidays/fiscal/library
 * templates, instantiate-to-workspace.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, longText } from "../schemas";
import { audit, requireOwned, assertWritable, requireOwnedForWrite } from "./common";
import { emit } from "../events";
import { govern, replayAggregate, snapshotAt, applyRetention } from "./temporal-governance";
import type { Ctx } from "./common";

// ---------------------------------------------------------------------------
// versions / rollback / replay / time-travel
// ---------------------------------------------------------------------------

export async function listVersions(ctx: Ctx, entityType: string, entityId: string) {
  if (!z.enum(["CALENDAR", "PATTERN", "RULE", "EVENT", "RESOURCE", "APPOINTMENT", "TRIGGER", "TIME_SYSTEM", "LIBRARY_TEMPLATE", "FISCAL_CALENDAR", "CONFIGURATION"]).safeParse(entityType).success) {
    throw new AppError(ErrorCodes.VALIDATION, "Unknown entityType");
  }
  const rows = await db.temporalVersion.findMany({
    where: { orgId: ctx.orgId, entityType: entityType as never, entityId },
    orderBy: { version: "desc" },
    take: 100,
    select: { id: true, version: true, change: true, summary: true, actorId: true, createdAt: true },
  });
  return rows;
}

export async function getVersion(ctx: Ctx, id: string) {
  const v = await requireOwned(await db.temporalVersion.findUnique({ where: { id } }), "Version", ctx.orgId);
  return v;
}

const ROLLBACKABLE: Record<string, "pattern" | "calendar" | "rule" | "trigger"> = {
  PATTERN: "pattern",
  CALENDAR: "calendar",
  RULE: "rule",
  TRIGGER: "trigger",
};

export async function rollbackToVersion(ctx: Ctx, entityType: string, entityId: string, version: number) {
  const kind = ROLLBACKABLE[entityType];
  if (!kind) throw new AppError(ErrorCodes.VALIDATION, `Rollback not supported for ${entityType} (audit trail only)`);
  const v = await db.temporalVersion.findFirst({ where: { orgId: ctx.orgId, entityType: entityType as never, entityId, version } });
  if (!v) throw new AppError(ErrorCodes.NOT_FOUND, "Version not found");
  const snap = v.snapshot as Record<string, unknown>;
  await db.$transaction(async (tx) => {
    if (kind === "pattern") {
      await tx.temporalPattern.update({
        where: { id: entityId },
        data: {
          name: String(snap.name),
          description: (snap.description as string | null) ?? null,
          spec: (snap.spec ?? {}) as object,
          dsl: (snap.dsl as string | null) ?? null,
          freq: snap.freq as never,
          timezone: String(snap.timezone ?? "Asia/Kolkata"),
          version: { increment: 1 },
        },
      });
    } else if (kind === "calendar") {
      await tx.calendar.update({
        where: { id: entityId },
        data: {
          name: String(snap.name),
          kind: snap.kind as never,
          visibility: snap.visibility as never,
          timezone: String(snap.timezone ?? "Asia/Kolkata"),
          color: String(snap.color ?? "#6366f1"),
          space: (snap.space as string | null) ?? null,
        },
      });
    } else if (kind === "rule") {
      await tx.temporalRule.update({
        where: { id: entityId },
        data: { name: String(snap.name), params: (snap.params ?? {}) as object, priority: Number(snap.priority ?? 100), hard: Boolean(snap.hard ?? true) },
      });
    } else {
      await tx.temporalTrigger.update({
        where: { id: entityId },
        data: { name: String(snap.name), anchor: (snap.anchor ?? {}) as object, dsl: (snap.dsl as string | null) ?? null },
      });
    }
    await audit(tx, ctx, "temporal.rollback", undefined, entityId, { entityType, toVersion: version });
    const current =
      kind === "pattern" ? await tx.temporalPattern.findUnique({ where: { id: entityId } })
        : kind === "calendar" ? await tx.calendar.findUnique({ where: { id: entityId } })
          : kind === "rule" ? await tx.temporalRule.findUnique({ where: { id: entityId } })
            : await tx.temporalTrigger.findUnique({ where: { id: entityId } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: entityType as never, entityId, event: "RolledBack", snapshot: current, payload: { toVersion: version } });
    await emit(tx, { type: "governance.rolled_back", aggregateType: entityType, aggregateId: entityId, orgId: ctx.orgId, payload: { version } });
  });
  return { rolledBack: true, toVersion: version };
}

export async function readReplay(ctx: Ctx, entityType: string, entityId: string, params: URLSearchParams) {
  if (!z.enum(["CALENDAR", "PATTERN", "RULE", "EVENT", "RESOURCE", "APPOINTMENT", "TRIGGER", "TIME_SYSTEM", "LIBRARY_TEMPLATE", "FISCAL_CALENDAR", "CONFIGURATION"]).safeParse(entityType).success) {
    throw new AppError(ErrorCodes.VALIDATION, "Unknown entityType");
  }
  const at = params.get("at");
  if (at) {
    const snap = await snapshotAt(entityType as never, entityId, new Date(at), ctx.orgId);
    if (!snap) throw new AppError(ErrorCodes.NOT_FOUND, "No state at that time");
    return { mode: "time_travel", at, version: snap.version, state: snap.snapshot };
  }
  return { mode: "replay", ...(await replayAggregate(entityType as never, entityId, ctx.orgId)) };
}

export async function eventLog(ctx: Ctx, params: URLSearchParams) {
  const type = params.get("type") ?? undefined;
  const aggregate = params.get("aggregateId") ?? undefined;
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date(Date.now() - 14 * 86_400_000);
  return db.temporalEventLog.findMany({
    where: { orgId: ctx.orgId, ...(type ? { type: { startsWith: type } } : {}), ...(aggregate ? { aggregateId: aggregate } : {}), at: { gte: from } },
    orderBy: { at: "desc" },
    take: 200,
  });
}

/** Governance cron sweep: retention pruning + expired slot holds. */
export async function governanceSweep(): Promise<{ prunedEvents: number; prunedVersions: number; holdsExpired: number }> {
  const ret = await applyRetention();
  const holds = await db.appointmentSlot.updateMany({
    where: { status: "HELD", holdExpiresAt: { lt: new Date() } },
    data: { status: "OPEN", holdExpiresAt: null },
  });
  await db.systemSetting.upsert({
    where: { key: "cron:temporal-governance" },
    create: { key: "cron:temporal-governance", value: { at: new Date().toISOString() } },
    update: { value: { at: new Date().toISOString() } },
  });
  return { prunedEvents: ret.prunedEvents, prunedVersions: ret.prunedVersions, holdsExpired: holds.count };
}

// ---------------------------------------------------------------------------
// temporal rules
// ---------------------------------------------------------------------------

export const ruleSchema = z.object({
  name: nameish,
  type: z.enum(["BUSINESS_HOURS", "WORKING_DAYS", "HOLIDAY", "COMPLIANCE", "RESOURCE", "CAPACITY", "CUSTOM"]),
  params: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(1).max(1000).default(100),
  hard: z.boolean().default(true),
});

export async function createRule(ctx: Ctx, input: unknown) {
  const data = ruleSchema.parse(input);
  await assertWritable(ctx.orgId);
  const rule = await db.$transaction(async (tx) => {
    const r = await tx.temporalRule.create({ data: { orgId: ctx.orgId, ...data, params: data.params as object, createdById: ctx.userId } });
    await audit(tx, ctx, "rule.created", undefined, r.id, { type: r.type });
    await emit(tx, { type: "rule.created", aggregateType: "TEMPORAL_RULE", aggregateId: r.id, orgId: ctx.orgId });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "RULE", entityId: r.id, event: "RuleCreated", snapshot: r });
    return r;
  });
  return rule;
}

export async function listRules(ctx: Ctx) {
  return db.temporalRule.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
}

export async function updateRule(ctx: Ctx, id: string, input: unknown) {
  const data = ruleSchema.partial().parse(input);
  const r = await requireOwnedForWrite(await db.temporalRule.findUnique({ where: { id } }), "Rule", ctx);
  const updated = await db.temporalRule.update({ where: { id }, data: { ...data, params: data.params as object | undefined } });
  await audit(db, ctx, "rule.updated", undefined, r.id);
  await db.temporalVersion.create({
    data: { orgId: ctx.orgId, entityType: "RULE", entityId: id, version: (await db.temporalVersion.count({ where: { entityType: "RULE", entityId: id } })) + 1, snapshot: updated as object, change: "rule.updated", actorId: ctx.userId },
  });
  return updated;
}

export async function deleteRule(ctx: Ctx, id: string) {
  const r = await requireOwnedForWrite(await db.temporalRule.findUnique({ where: { id } }), "Rule", ctx);
  await db.temporalRule.update({ where: { id }, data: { active: false } });
  await audit(db, ctx, "rule.retired", undefined, r.id);
  return { retired: true };
}

// ---------------------------------------------------------------------------
// holiday calendars
// ---------------------------------------------------------------------------

export const holidaySchema = z.object({
  name: nameish,
  code: z.string().trim().max(60).regex(/^[A-Za-z0-9-]+$/),
  country: z.string().trim().max(2).nullable().optional(),
  dates: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(80), recurringAnnual: z.boolean().default(false) })).min(1).max(500),
});

export async function createHolidayCalendar(ctx: Ctx, input: unknown) {
  const data = holidaySchema.parse(input);
  await assertWritable(ctx.orgId);
  const cal = await db.$transaction(async (tx) => {
    const c = await tx.holidayCalendar.create({
      data: {
        orgId: ctx.orgId,
        name: data.name,
        code: data.code,
        country: data.country ?? null,
        entries: { create: data.dates.map((d) => ({ orgId: ctx.orgId, date: new Date(`${d.date}T00:00:00Z`), name: d.name, recurringAnnual: d.recurringAnnual })) },
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, "holidays.created", undefined, c.id, { count: data.dates.length });
    await emit(tx, { type: "holidays.created", aggregateType: "HOLIDAY_CALENDAR", aggregateId: c.id, orgId: ctx.orgId, payload: { count: data.dates.length } });
    return c;
  });
  return { id: cal.id, name: cal.name, code: cal.code, entries: data.dates.length };
}

export async function listHolidayCalendars(ctx: Ctx) {
  return db.holidayCalendar.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    include: { _count: { select: { entries: true } } },
    orderBy: { code: "asc" },
  });
}

export async function getHolidays(ctx: Ctx, id: string, year?: number) {
  const cal = await requireOwned(await db.holidayCalendar.findUnique({ where: { id } }), "Holiday calendar", ctx.orgId);
  const entries = await db.holiday.findMany({
    where: {
      calendarId: cal.id,
      ...(year ? { OR: [{ date: { gte: new Date(Date.UTC(year, 0, 1)) }, }, { recurringAnnual: true }] } : {}),
    },
    orderBy: { date: "asc" },
    take: 500,
  });
  return { calendar: { id: cal.id, name: cal.name, code: cal.code }, entries };
}

// ---------------------------------------------------------------------------
// fiscal calendars & library templates (instantiable)
// ---------------------------------------------------------------------------

export const fiscalSchema = z.object({
  name: nameish,
  code: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]+$/),
  anchorMonth: z.number().int().min(1).max(12).default(4),
  startDay: z.number().int().min(1).max(28).default(1),
  period: z.enum(["MONTHLY", "QUARTERLY", "WEEKLY_445", "WEEKLY_13"]).default("QUARTERLY"),
});

export async function upsertFiscalCalendar(ctx: Ctx, input: unknown) {
  const data = fiscalSchema.parse(input);
  const existing = await db.fiscalCalendar.findFirst({ where: { OR: [{ orgId: ctx.orgId, code: data.code }, { orgId: null, code: data.code }] } });
  if (existing && existing.orgId !== ctx.orgId) throw new AppError(ErrorCodes.FORBIDDEN, "Code reserved by platform library");
  const fc = await db.fiscalCalendar.upsert({
    where: { id: existing?.id ?? "" },
    create: { orgId: ctx.orgId, ...data },
    update: data,
  });
  await audit(db, ctx, "fiscal.upserted", undefined, fc.id, { code: fc.code });
  return fc;
}

export async function listFiscalCalendars(ctx: Ctx) {
  return db.fiscalCalendar.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: { code: "asc" } });
}

/** Fiscal period math for any date (pure) — quarter + period-in-year labels. */
export async function fiscalPeriodOf(ctx: Ctx, code: string, at: string) {
  const fc = await db.fiscalCalendar.findFirst({ where: { OR: [{ orgId: ctx.orgId, code }, { orgId: null, code }] } });
  if (!fc) throw new AppError(ErrorCodes.NOT_FOUND, "Fiscal calendar not found");
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid date");
  const y = d.getUTCFullYear();
  const fyStartYear = d.getUTCMonth() + 1 >= fc.anchorMonth ? y : y - 1;
  const start = Date.UTC(fyStartYear, fc.anchorMonth - 1, fc.startDay);
  const idx = Math.floor((d.getTime() - start) / 86_400_000 / 7 / (fc.period === "WEEKLY_445" || fc.period === "WEEKLY_13" ? 1 : 4.33));
  const monthsSince = (((d.getUTCMonth() - (fc.anchorMonth - 1)) % 12) + 12) % 12;
  const q = Math.floor(monthsSince / 3) + 1;
  return {
    fiscalCode: fc.code,
    fiscalYear: `${fyStartYear}/${String((fyStartYear + 1) % 100).padStart(2, "0")}`,
    quarter: fc.period === "MONTHLY" ? null : `FY${String((fyStartYear + 1) % 100).padStart(2, "0")}-Q${q}`,
    month: `FY${String((fyStartYear + 1) % 100).padStart(2, "0")}-M${monthsSince + 1}`,
    periodIndex: idx + 1,
    period: fc.period,
  };
}

export async function listLibraryTemplates(ctx: Ctx) {
  return db.libraryTemplate.findMany({
    where: { OR: [{ orgId: null }, { orgId: ctx.orgId }] },
    orderBy: [{ isGlobal: "desc" }, { kind: "asc" }, { name: "asc" }],
  });
}

export const libraryTemplateSchema = z.object({
  kind: z.enum(["BUSINESS_HOURS", "TRADING_HOURS", "OFFICE_HOURS", "FISCAL_CALENDAR", "HOLIDAY_CALENDAR", "MAINTENANCE_WINDOW", "SHIFT_TEMPLATE", "INDUSTRY", "ENTERPRISE"]),
  name: nameish,
  code: z.string().trim().max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
  industry: z.string().trim().max(40).nullable().optional(),
  description: longText.nullable().optional(),
  template: z.record(z.string(), z.unknown()),
});

export async function upsertLibraryTemplate(ctx: Ctx, input: unknown) {
  const data = libraryTemplateSchema.parse(input);
  if (!ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Platform-admin only: library templates are global");
  const existing = await db.libraryTemplate.findFirst({ where: { orgId: null, code: data.code } });
  return db.libraryTemplate.upsert({
    where: { id: existing?.id ?? "" },
    create: { orgId: null, kind: data.kind as never, name: data.name, code: data.code, industry: data.industry ?? null, description: data.description ?? null, template: data.template as object, isGlobal: true },
    update: { kind: data.kind as never, name: data.name, industry: data.industry ?? null, description: data.description ?? null, template: data.template as object },
  });
}

/**
 * Instantiate a library template into the workspace: creates the pattern /
 * rule / holiday calendar / shift it describes. Returns created ids.
 */
export async function instantiateTemplate(ctx: Ctx, id: string) {
  const tpl = await db.libraryTemplate.findFirst({ where: { OR: [{ id, orgId: null }, { id, orgId: ctx.orgId }] } });
  if (!tpl) throw new AppError(ErrorCodes.NOT_FOUND, "Template not found");
  const t = tpl.template as Record<string, unknown>;
  const created: Record<string, string[]> = { patterns: [], rules: [], shifts: [], holidayCalendars: [], fiscalCalendars: [] };
  await db.$transaction(async (tx) => {
    for (const p of (t.patterns as Array<Record<string, unknown>> | undefined) ?? []) {
      const { createPattern } = await import("./temporal.service");
      const pat = await createPattern(ctx, { name: String(p.name ?? tpl.name), dsl: (p.dsl as string) ?? null, spec: (p.spec as Record<string, unknown>) ?? null, type: (p.type as string) ?? "WINDOW", timezone: (p.timezone as string) ?? "Asia/Kolkata" });
      created.patterns.push((pat.pattern as { id: string }).id);
    }
    for (const r of (t.rules as Array<Record<string, unknown>> | undefined) ?? []) {
      const rule = await tx.temporalRule.create({
        data: {
          orgId: ctx.orgId,
          name: String(r.name ?? `${tpl.name} rule`),
          type: (r.type as string ?? "CUSTOM") as never,
          params: ((r.params as object) ?? {}) as object,
          priority: Number(r.priority ?? 100),
          hard: Boolean(r.hard ?? true),
          createdById: ctx.userId,
        },
      });
      created.rules.push(rule.id);
    }
    for (const s of (t.shifts as Array<Record<string, unknown>> | undefined) ?? []) {
      const code = `${tpl.code.toLowerCase()}-${String(created.shifts.length + 1)}`;
      const shift = await tx.shift.create({
        data: {
          orgId: ctx.orgId,
          name: String(s.name ?? "Shift"),
          code,
          kind: (s.kind as string ?? "FIXED") as never,
          startTime: String(s.startTime ?? "09:00"),
          endTime: String(s.endTime ?? "17:00"),
          crossDay: Boolean(s.crossDay ?? false),
          color: String(s.color ?? "#0ea5e9"),
          createdById: ctx.userId,
        },
      });
      created.shifts.push(shift.id);
    }
    const hc = t.holidayCalendar as { code?: string; name?: string; entries?: Array<{ date: string; name: string; recurringAnnual?: boolean }> } | undefined;
    if (hc?.entries?.length) {
      const hcal = await tx.holidayCalendar.create({
        data: {
          orgId: ctx.orgId,
          name: String(hc.name ?? `${tpl.name} holidays`),
          code: String(hc.code ?? `${tpl.code}-HL`),
          createdById: ctx.userId,
          entries: { create: hc.entries.map((e) => ({ orgId: ctx.orgId, date: new Date(`${e.date}T00:00:00Z`), name: e.name, recurringAnnual: !!e.recurringAnnual })) },
        },
      });
      created.holidayCalendars.push(hcal.id);
    }
    const f = t.fiscal as { code?: string; name?: string; anchorMonth?: number; period?: string } | undefined;
    if (f) {
      const fc = await tx.fiscalCalendar.create({
        data: {
          orgId: ctx.orgId,
          name: String(f.name ?? `${tpl.name} fiscal`),
          code: String(f.code ?? `${tpl.code}-FY`),
          anchorMonth: Number(f.anchorMonth ?? 4),
          period: (f.period as string ?? "QUARTERLY") as never,
        },
      });
      created.fiscalCalendars.push(fc.id);
    }
    await audit(tx, ctx, "library.instantiated", undefined, tpl.id, { kind: tpl.kind, created: Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])) });
    await emit(tx, { type: "library.instantiated", aggregateType: "LIBRARY_TEMPLATE", aggregateId: tpl.id, orgId: ctx.orgId, payload: { kind: tpl.kind } });
  });
  return { template: tpl.code, created };
}

// ---------------------------------------------------------------------------
// time systems
// ---------------------------------------------------------------------------

export const timeSystemSchema = z.object({
  code: z.string().trim().max(40).regex(/^[A-Z0-9][A-Z0-9+_.:-]*$/),
  name: nameish,
  kind: z.enum(["LINEAR_OFFSET", "ROTATION", "CUSTOM"]).default("LINEAR_OFFSET"),
  utcOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  unitSeconds: z.number().int().min(1).max(864000).default(86400),
  epochIso: z.string().nullable().optional(),
  label: z.string().trim().max(20).default("day"),
});

export async function upsertTimeSystem(ctx: Ctx, input: unknown) {
  const data = timeSystemSchema.parse(input);
  if (!ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Platform-admin only: time systems are global");
  const epochMicros = data.epochIso ? BigInt(new Date(data.epochIso).getTime()) * 1000n : 0n;
  const existingTs = await db.timeSystem.findFirst({ where: { orgId: null, code: data.code } });
  const ts = existingTs
    ? await db.timeSystem.update({
        where: { id: existingTs.id },
        data: { name: data.name, kind: data.kind as never, utcOffsetMinutes: data.utcOffsetMinutes, unitSeconds: data.unitSeconds, epochMicros, label: data.label },
      })
    : await db.timeSystem.create({
        data: { orgId: null, name: data.name, code: data.code, kind: data.kind as never, utcOffsetMinutes: data.utcOffsetMinutes, unitSeconds: data.unitSeconds, epochMicros, label: data.label },
      });
  await audit(db, ctx, "timesystem.upserted", undefined, ts.id, { code: ts.code });
  return ts;
}

/** Convert an instant into any time system (planetary/offset aware). */
export async function convertTimeSystem(ctx: Ctx, params: URLSearchParams) {
  const code = params.get("code");
  const at = params.get("at");
  if (!code || !at) throw new AppError(ErrorCodes.VALIDATION, "code and at are required");
  const ts = await db.timeSystem.findFirst({ where: { OR: [{ code, orgId: ctx.orgId }, { code, orgId: null }] } });
  if (!ts) throw new AppError(ErrorCodes.NOT_FOUND, "Unknown time system");
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid instant");
  const { toSystemMicros, formatInSystem } = await import("../temporal/units");
  const def = { kind: ts.kind, utcOffsetMinutes: ts.utcOffsetMinutes, unitSeconds: ts.unitSeconds, epochMicros: ts.epochMicros };
  return {
    code: ts.code,
    name: ts.name,
    utc: d.toISOString(),
    system: formatInSystem(d, def, ts.label),
    systemMicros: toSystemMicros(d.getTime(), def).toString(),
  };
}
