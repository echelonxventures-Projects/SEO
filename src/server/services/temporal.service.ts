/**
 * UTP core service — Calendar Domain + Temporal Pattern assets + Event
 * Management (lifecycle, series, occurrences, exceptions) + Agenda + Config.
 *
 * Constitution: events CONSUME patterns; patterns are independently governed
 * temporal assets (DSL-compilable, versioned, event-logged). Nothing here is
 * stubbed; materialization is window-bounded and deterministic.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, longText } from "../schemas";
import { audit, requireOwned, assertWritable } from "./common";
import { emit } from "../events";
import { govern } from "./temporal-governance";
import type { Ctx } from "./common";
import type { Prisma } from "@/generated/prisma/client";
import { parseDsl, validateSpec, optimizeSpec, planExecution, compilePattern, DslError } from "../temporal/dsl";
import { materialize } from "../temporal/recurrence";
import { expandPattern, resolveHolidaySet } from "./temporal-frame";
import { utcToWall } from "../temporal/tz";

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

export const calendarSchema = z.object({
  name: nameish,
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  kind: z.enum(["PERSONAL", "TEAM", "RESOURCE", "PROJECT", "EVENT", "CAMPAIGN", "SYSTEM", "FISCAL", "MAINTENANCE", "SHIFT"]).default("TEAM"),
  visibility: z.enum(["PRIVATE", "INTERNAL", "PUBLIC"]).default("INTERNAL"),
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  color: z.string().trim().max(16).default("#6366f1"),
  description: longText.nullable().optional(),
  space: z.string().trim().max(60).nullable().optional(),
  patternId: z.string().max(64).nullable().optional(),
  timeSystemCode: z.string().trim().max(40).nullable().optional(),
  ownerUserId: z.string().max(64).nullable().optional(),
  retentionDays: z.number().int().min(0).max(36500).nullable().optional(),
});

export const shareSchema = z.object({
  principalType: z.enum(["USER", "TEAM", "ORGANIZATION", "PUBLIC"]).default("USER"),
  principalId: z.string().trim().max(64).min(1),
  permission: z.enum(["VIEW", "SUGGEST", "EDIT", "MANAGE"]).default("VIEW"),
});

export const patternSchema = z.object({
  name: nameish,
  description: longText.nullable().optional(),
  type: z.enum(["TIME", "DATE", "DATE_RANGE", "TIME_RANGE", "DURATION", "WINDOW", "TRIGGER", "CONSTRAINT", "DEPENDENCY", "COMPOSITE"]).default("WINDOW"),
  dsl: z.string().trim().min(1).max(400).nullable().optional(),
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  timeSystemCode: z.string().trim().max(40).nullable().optional(), // bind to a TimeSystem (planetary/custom frames)
  isLibrary: z.boolean().default(false),
});

export const eventSchema = z.object({
  calendarId: z.string().min(1),
  title: nameish,
  description: longText.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/)),
  endsAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/)),
  allDay: z.boolean().default(false),
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  patternId: z.string().max(64).nullable().optional(), // present ⇒ SERIES_MASTER consuming that asset
  location: z.string().trim().max(140).nullable().optional(),
  capacity: z.number().int().min(0).max(100000).default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
  attendees: z.array(z.object({ kind: z.enum(["USER", "CLIENT", "CONTACT", "RESOURCE", "TEAM"]).default("USER"), refId: z.string().max(64).nullable().optional(), email: z.string().email().nullable().optional(), name: z.string().trim().max(120).nullable().optional() })).max(100).optional(),
  materializeDays: z.number().int().min(1).max(365).optional(), // unset ⇒ workspace config horizon
});

const eventPatchSchema = eventSchema.extend({
  status: z.enum(["TENTATIVE", "CONFIRMED", "COMPLETED"]).optional(),
});

export const dependencySchema = z.object({
  scope: z.enum(["EVENT", "WORKFLOW"]).default("EVENT"),
  fromType: z.string().trim().max(30).default("event"),
  fromId: z.string().min(1),
  toType: z.string().trim().max(30).default("event"),
  toId: z.string().min(1),
  type: z.enum(["FINISH_TO_START", "START_TO_START", "FINISH_TO_FINISH", "START_TO_FINISH"]),
  lagValue: z.number().int().min(-100000).max(100000).default(0),
  lagUnit: z.enum(["MINUTES", "HOURS", "DAYS"]).default("HOURS"),
});

const WINDOW_DAYS = 400;

// ---------------------------------------------------------------------------
// calendars
// ---------------------------------------------------------------------------

export async function createCalendar(ctx: Ctx, input: unknown) {
  const data = calendarSchema.parse(input);
  await assertWritable(ctx.orgId);
  const dup = await db.calendar.findFirst({ where: { orgId: ctx.orgId, code: data.code, archivedAt: null } });
  if (dup) throw new AppError(ErrorCodes.CONFLICT, `Calendar code "${data.code}" already exists`);
  let timeSystemId: string | null = null;
  if (data.timeSystemCode) {
    const ts = await db.timeSystem.findFirst({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], code: data.timeSystemCode, active: true } });
    if (!ts) throw new AppError(ErrorCodes.VALIDATION, `Unknown time system "${data.timeSystemCode}"`);
    timeSystemId = ts.id;
  }
  const cal = await db.$transaction(async (tx) => {
    const created = await tx.calendar.create({
      data: {
        orgId: ctx.orgId,
        name: data.name,
        code: data.code,
        kind: data.kind,
        visibility: data.visibility,
        timezone: data.timezone,
        color: data.color,
        description: data.description ?? null,
        space: data.space ?? null,
        patternId: data.patternId ?? null,
        timeSystemId,
        ownerUserId: data.ownerUserId ?? ctx.userId,
        retentionDays: data.retentionDays ?? null,
        createdById: ctx.userId,
      },
    });
    await tx.calendarShare.create({
      data: { orgId: ctx.orgId, calendarId: created.id, principalType: "USER", principalId: ctx.userId, permission: "MANAGE" },
    });
    await audit(tx, ctx, "calendar.created", undefined, created.id, { code: created.code });
    await emit(tx, { type: "calendar.created", aggregateType: "CALENDAR", aggregateId: created.id, orgId: ctx.orgId, payload: { code: created.code, kind: created.kind } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "CALENDAR", entityId: created.id, event: "CalendarCreated", snapshot: created });
    return created;
  });
  return cal;
}

export async function listCalendars(ctx: Ctx) {
  const mine = await db.calendarShare.findMany({ where: { orgId: ctx.orgId, principalId: ctx.userId }, select: { calendarId: true, permission: true } });
  const ids = new Set(mine.map((s) => s.calendarId));
  const rows = await db.calendar.findMany({
    where: {
      orgId: ctx.orgId,
      archivedAt: null,
      OR: [{ ownerUserId: ctx.userId }, { id: { in: [...ids] } }, { visibility: "INTERNAL" }, { visibility: "PUBLIC" }],
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { events: true, appointments: true, shares: true } }, timeSystem: { select: { code: true, label: true } } },
  });
  return rows.map((r) => ({ ...r, myPermission: r.ownerUserId === ctx.userId ? "MANAGE" : mine.find((s) => s.calendarId === r.id)?.permission ?? (r.visibility === "INTERNAL" ? "VIEW" : "VIEW") }));
}

export async function getCalendar(ctx: Ctx, id: string) {
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id } }), "Calendar", ctx.orgId);
  const shares = await db.calendarShare.findMany({ where: { calendarId: id } });
  return { ...cal, shares, events: await db.scheduledEvent.count({ where: { calendarId: id } }) };
}

export async function updateCalendar(ctx: Ctx, id: string, input: unknown) {
  const data = calendarSchema.partial().pick({ name: true, kind: true, visibility: true, timezone: true, color: true, description: true, space: true, patternId: true, retentionDays: true }).parse(input);
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id } }), "Calendar", ctx.orgId);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.calendar.update({ where: { id }, data });
    await audit(tx, ctx, "calendar.updated", undefined, id, { fields: Object.keys(data) });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "CALENDAR", entityId: id, event: "CalendarUpdated", snapshot: u, payload: { fields: Object.keys(data) } });
    return u;
  });
  return updated;
}

export async function archiveCalendar(ctx: Ctx, id: string) {
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id } }), "Calendar", ctx.orgId);
  if (cal.archivedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Calendar already archived");
  await db.$transaction(async (tx) => {
    await tx.calendar.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, ctx, "calendar.archived", undefined, id);
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "CALENDAR", entityId: id, event: "CalendarArchived" });
  });
  return { archived: true };
}

export async function shareCalendar(ctx: Ctx, id: string, input: unknown) {
  const data = shareSchema.parse(input);
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id } }), "Calendar", ctx.orgId);
  if (data.principalType === "PUBLIC" && cal.visibility === "PRIVATE") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Cannot share a PRIVATE calendar publicly");
  const share = await db.calendarShare.upsert({
    where: { calendarId_principalType_principalId: { calendarId: id, principalType: data.principalType, principalId: data.principalId } },
    create: { orgId: ctx.orgId, calendarId: id, ...data },
    update: { permission: data.permission },
  });
  await audit(db, ctx, "calendar.shared", undefined, id, { share: `${data.principalType}:${data.principalId}`, permission: data.permission });
  await emit(db, { type: "calendar.shared", aggregateType: "CALENDAR", aggregateId: id, orgId: ctx.orgId, payload: { principal: data.principalId, permission: data.permission } });
  return share;
}

export async function unshareCalendar(ctx: Ctx, id: string, shareId: string) {
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id } }), "Calendar", ctx.orgId);
  const share = await db.calendarShare.findUnique({ where: { id: shareId } });
  if (!share || share.calendarId !== cal.id) throw new AppError(ErrorCodes.NOT_FOUND, "Share not found");
  if (share.principalId === ctx.userId && share.permission === "MANAGE") {
    const managers = await db.calendarShare.count({ where: { calendarId: id, permission: "MANAGE", id: { not: shareId } } });
    if (!managers) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Cannot remove the last manager of a calendar");
  }
  await db.calendarShare.delete({ where: { id: shareId } });
  await audit(db, ctx, "calendar.unshared", undefined, id, { shareId });
}

// ---------------------------------------------------------------------------
// time systems (visible to the workspace)
// ---------------------------------------------------------------------------

export async function listTimeSystems(ctx: Ctx) {
  return db.timeSystem.findMany({ where: { OR: [{ orgId: null }, { orgId: ctx.orgId }], active: true }, orderBy: [{ orgId: { sort: "asc", nulls: "first" } }, { code: "asc" }] });
}

// ---------------------------------------------------------------------------
// patterns — the reusable temporal assets
// ---------------------------------------------------------------------------

function compileBody(dsl: string | null | undefined, spec: Record<string, unknown> | null | undefined): { specJson: z.infer<typeof patternSpec>; warnings: string[] } {
  const warnings: string[] = [];
  if (dsl) {
    let compiled;
    try {
      compiled = parseDsl(dsl);
    } catch (e) {
      if (e instanceof DslError) throw new AppError(ErrorCodes.VALIDATION, `DSL error: ${e.message}`, { diagnostics: e.diagnostics });
      throw e;
    }
    if (compiled.kind === "trigger") {
      const s = { freq: "NONE", time: null, trigger: compiled.trigger } as unknown;
      return { specJson: patternSpec.parse(s), warnings: compiled.warnings.map((w) => w.message) };
    }
    if (compiled.kind === "range") {
      const s = { freq: "NONE", time: null, range: compiled.range } as unknown;
      return { specJson: patternSpec.parse(s), warnings: compiled.warnings.map((w) => w.message) };
    }
    return { specJson: patternSpec.parse(compiled.spec), warnings: compiled.warnings.map((w) => w.message) };
  }
  if (!spec) throw new AppError(ErrorCodes.VALIDATION, "Provide dsl or spec");
  const parsed = patternSpec.safeParse(spec);
  if (!parsed.success) throw new AppError(ErrorCodes.VALIDATION, `Invalid spec: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { specJson: parsed.data, warnings };
}

export const patternSpec = z
  .object({
    freq: z.enum(["NONE", "SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"]).default("NONE"),
    interval: z.number().int().min(1).max(1000).optional(),
    time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    monthdays: z.array(z.number().int()).max(31).optional(),
    months: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    setPos: z.number().int().min(-5).max(5).optional(),
    posWeekday: z.number().int().min(0).max(6).optional(),
    byBusinessDay: z.boolean().optional(),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    count: z.number().int().min(1).max(100000).optional(),
    until: z.string().nullable().optional(),
    durationMinutes: z.number().int().min(0).max(5256000).optional(),
    customRule: z.string().max(120).optional(),
    trigger: z.record(z.string(), z.unknown()).optional(),
    range: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export async function createPattern(ctx: Ctx, input: unknown) {
  const data = patternSchema.parse(input);
  await assertWritable(ctx.orgId);
  let patternTimeSystemId: string | null = null;
  if (data.timeSystemCode) {
    const ts = await db.timeSystem.findFirst({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], code: data.timeSystemCode, active: true } });
    if (!ts) throw new AppError(ErrorCodes.VALIDATION, `Unknown time system "${data.timeSystemCode}"`);
    patternTimeSystemId = ts.id;
  }
  if (data.isLibrary && !ctx.viewer.isPlatformAdmin) {
    // org users may publish workspace-level library assets but not global ones
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform-admin only for global library patterns");
  }
  const { specJson, warnings } = compileBody(data.dsl, data.spec);
  const diags = validateSpec(specJson as never);
  const errors = diags.filter((d) => d.level === "error");
  if (errors.length) throw new AppError(ErrorCodes.VALIDATION, `Pattern invalid: ${errors.map((e) => e.message).join("; ")}`, { diagnostics: diags });
  const optimized = optimizeSpec(specJson as never);
  const plan = planExecution(optimized);
  const pattern = await db.$transaction(async (tx) => {
    const created = await tx.temporalPattern.create({
      data: {
        orgId: data.isLibrary ? null : ctx.orgId,
        name: data.name,
        description: data.description ?? null,
        type: data.type,
        freq: optimized.freq as never,
        spec: optimized as object,
        dsl: data.dsl ?? null,
        timezone: data.timezone,
        timeSystemId: patternTimeSystemId,
        isLibrary: !!data.isLibrary,
        createdById: ctx.userId,
        expressions: {
          create: {
            orgId: data.isLibrary ? null : ctx.orgId,
            source: data.dsl ?? JSON.stringify(optimized),
            ast: optimized as object,
            plan: plan as object,
            diagnostics: diags as object[],
            status: "OPTIMIZED",
            checksum: hashish(`${data.dsl ?? ""}|${JSON.stringify(optimized)}`),
          },
        },
      },
    });
    await audit(tx, ctx, "pattern.created", undefined, created.id, { name: created.name, freq: created.freq });
    await emit(tx, { type: "pattern.created", aggregateType: "PATTERN", aggregateId: created.id, orgId: data.isLibrary ? null : ctx.orgId, payload: { name: created.name, freq: created.freq } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "PATTERN", entityId: created.id, event: "PatternCreated", snapshot: created, payload: { dsl: data.dsl ?? null } });
    return created;
  });
  return { pattern, warnings, diagnostics: diags };
}

function hashish(s: string): string {
  // fast deterministic 16-hex (collision-safe enough for compile caches)
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 24);
}

export async function listPatterns(ctx: Ctx) {
  return db.temporalPattern.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    orderBy: [{ isLibrary: "asc" }, { name: "asc" }],
    include: { _count: { select: { events: true, calendars: true } } },
  });
}

export async function getPattern(ctx: Ctx, id: string) {
  return requireOwned(await db.temporalPattern.findUnique({ where: { id }, include: { expressions: true } }), "Pattern", ctx.orgId);
}

export async function updatePattern(ctx: Ctx, id: string, input: unknown) {
  const data = patternSchema.partial().parse(input);
  const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id } }), "Pattern", ctx.orgId);
  if (pat.isLibrary) throw new AppError(ErrorCodes.FORBIDDEN, "Library patterns are read-only; clone to customize");
  let patternTimeSystemId: string | null | undefined;
  if (data.timeSystemCode !== undefined) {
    if (data.timeSystemCode === null) patternTimeSystemId = null;
    else {
      const ts = await db.timeSystem.findFirst({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], code: data.timeSystemCode, active: true } });
      if (!ts) throw new AppError(ErrorCodes.VALIDATION, `Unknown time system "${data.timeSystemCode}"`);
      patternTimeSystemId = ts.id;
    }
  }
  const { specJson } = compileBody(data.dsl ?? pat.dsl, (data.spec ?? pat.spec) as Record<string, unknown> | null | undefined);
  const optimized = optimizeSpec(specJson as never);
  if (validateSpec(optimized as never).some((d) => d.level === "error")) throw new AppError(ErrorCodes.VALIDATION, "Updated pattern does not validate");
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.temporalPattern.update({
      where: { id },
      data: { name: data.name, description: data.description, spec: optimized as object, dsl: data.dsl, freq: optimized.freq as never, timezone: data.timezone, timeSystemId: patternTimeSystemId, version: { increment: 1 } },
    });
    await tx.temporalExpression.create({
      data: { orgId: ctx.orgId, patternId: id, source: data.dsl ?? pat.dsl ?? "", ast: optimized as object, plan: planExecution(optimized as never) as object, status: "OPTIMIZED", checksum: hashish(`${id}:${pat.version + 1}`) },
    });
    await audit(tx, ctx, "pattern.updated", undefined, id, { version: u.version });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "PATTERN", entityId: id, event: "PatternUpdated", snapshot: u, payload: { version: u.version } });
    await tx.temporalEventLog.create({ data: { orgId: ctx.orgId, aggregateType: "PATTERN", aggregateId: id, seq: (await tx.temporalEventLog.count({ where: { aggregateType: "PATTERN", aggregateId: id } })) + 1, type: "ScheduleVersioned", payload: { version: u.version } as object, actorId: ctx.userId } });
    return u;
  });
  return updated;
}

export async function deprecatePattern(ctx: Ctx, id: string) {
  const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id } }), "Pattern", ctx.orgId);
  if (pat.status === "DEPRECATED") return { status: pat.status };
  await db.$transaction(async (tx) => {
    await tx.temporalPattern.update({ where: { id }, data: { status: "DEPRECATED" } });
    await audit(tx, ctx, "pattern.deprecated", undefined, id);
    await emit(tx, { type: "pattern.deprecated", aggregateType: "PATTERN", aggregateId: id, orgId: pat.orgId ?? ctx.orgId });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "PATTERN", entityId: id, event: "PatternRetired" });
    await tx.temporalEventLog.create({ data: { orgId: ctx.orgId, aggregateType: "PATTERN", aggregateId: id, seq: (await tx.temporalEventLog.count({ where: { aggregateType: "PATTERN", aggregateId: id } })) + 1, type: "PatternRetired", payload: {} as object, actorId: ctx.userId } });
  });
  return { status: "DEPRECATED" };
}

/** Stateless DSL studio endpoint: parse → validate → optimize → plan. */
export async function dslStudio(input: unknown) {
  const { dsl, horizonDays = 30, timeSystemCode } = z.object({ dsl: z.string().trim().min(1).max(400), horizonDays: z.number().int().min(1).max(366).optional(), timeSystemCode: z.string().trim().max(40).nullable().optional() }).parse(input);
  const compiled = (() => {
    try {
      return { ok: true as const, value: parseDsl(dsl) };
    } catch (e) {
      if (e instanceof DslError) return { ok: false as const, diagnostics: e.diagnostics };
      throw e;
    }
  })();
  if (!compiled.ok) return { valid: false, compiled: null, diagnostics: compiled.diagnostics, next: [] };
  const artifact = compiled.value;
  if (artifact.kind === "pattern") {
    const diags = validateSpec(artifact.spec);
    const optimized = optimizeSpec(artifact.spec);
    const plan = planExecution(optimized);
    const from = new Date();
    const to = new Date(from.getTime() + horizonDays * 86_400_000);
    let tsDef: { id: string } | null = null;
    if (timeSystemCode) {
      const row = await db.timeSystem.findFirst({ where: { code: timeSystemCode, active: true } });
      if (!row) throw new AppError(ErrorCodes.VALIDATION, `Unknown time system "${timeSystemCode}"`);
      tsDef = { id: row.id };
    }
    const occurrences = diags.some((d) => d.level === "error")
      ? []
      : await expandPattern({ spec: optimized, timezone: "UTC", timeSystemId: tsDef?.id ?? null }, from, to, { max: 20 });
    return {
      valid: !diags.some((d) => d.level === "error"),
      compiled: { kind: "pattern", ast: optimized, plan, diagnostics: [...artifact.warnings, ...diags] },
      next: occurrences.map((o) => ({ start: o.startsAt.toISOString(), end: o.endsAt.toISOString() })),
    };
  }
  return { valid: true, compiled: { kind: artifact.kind, value: artifact.kind === "range" ? artifact.range : artifact.kind === "trigger" ? artifact.trigger : null, diagnostics: artifact.warnings }, next: [] };
}

/** Pattern preview: materialize the next N occurrences (UTC). */
export async function previewPattern(ctx: Ctx, id: string, from?: string, days?: number, max?: number) {
  const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id } }), "Pattern", ctx.orgId);
  const spec = pat.spec as never;
  const start = from ? new Date(from) : new Date();
  if (Number.isNaN(start.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid from date");
  const to = new Date(start.getTime() + Math.min(730, days ?? 90) * 86_400_000);
  const occ = await expandPattern(pat, start, to, { max: Math.min(200, max ?? 20), holidays: await resolveHolidaySet(ctx.orgId) });
  return { patternId: id, timezone: pat.timezone, occurrences: occ.map((o) => ({ start: o.startsAt.toISOString(), end: o.endsAt.toISOString(), index: o.index })) };
}

// ---------------------------------------------------------------------------
// events & occurrences
// ---------------------------------------------------------------------------

export async function requireCalendarWrite(ctx: Ctx, calendarId: string, need: "VIEW" | "SUGGEST" | "EDIT" | "MANAGE" = "EDIT") {
  const cal = await requireOwned(await db.calendar.findUnique({ where: { id: calendarId } }), "Calendar", ctx.orgId);
  if (cal.archivedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Calendar is archived");
  const share = await db.calendarShare.findFirst({ where: { calendarId, OR: [{ principalId: ctx.userId }, { principalType: "ORGANIZATION", principalId: ctx.orgId }, { principalType: "PUBLIC", principalId: "public" }] } });
  const rank = { VIEW: 0, SUGGEST: 1, EDIT: 2, MANAGE: 3 } as const;
  const have = cal.ownerUserId === ctx.userId ? "MANAGE" : share?.permission ?? (cal.visibility === "INTERNAL" ? "VIEW" : "VIEW");
  if (rank[have as "VIEW"] < rank[need]) throw new AppError(ErrorCodes.FORBIDDEN, `Calendar access is ${have}; ${need} required`);
  return cal;
}

async function holidaysForOrg(orgId: string): Promise<Set<string>> {
  return resolveHolidaySet(orgId); // honors TemporalConfiguration.holidayCalendarId
}

function holidayMatches(keys: Set<string>, d: Date): boolean {
  return keys.has(d.toISOString().slice(0, 10)) || keys.has(d.toISOString().slice(5, 10));
}

async function materializeSeries(
  tx: Prisma.TransactionClient,
  event: { id: string; orgId: string; patternId: string | null; timezone: string; startsAt: Date; endsAt: Date; overrides: unknown },
  horizonDays: number,
) {
  if (!event.patternId) {
    const exists = await tx.eventOccurrence.findFirst({ where: { eventId: event.id } });
    if (!exists) {
      await tx.eventOccurrence.create({
        data: { orgId: event.orgId, eventId: event.id, startsAt: event.startsAt, endsAt: event.endsAt },
      });
    }
    return { materialized: 1 };
  }
  const pattern = await tx.temporalPattern.findUnique({ where: { id: event.patternId } });
  if (!pattern) throw new AppError(ErrorCodes.NOT_FOUND, "Consumed pattern disappeared");
  const spec = pattern.spec as never;
  const holidays = await holidaysForOrg(event.orgId);
  const wEnd = new Date(Math.max(event.endsAt.getTime(), Date.now()) + Math.min(WINDOW_DAYS, horizonDays) * 86_400_000);
  const occ = await expandPattern({ spec: pattern.spec, timezone: event.timezone, timeSystemId: pattern.timeSystemId }, event.startsAt, wEnd, { max: 500, holidays });
  const overrides = (event.overrides ?? {}) as { skipped?: string[]; moved?: Array<{ from: string; to: string }> };
  const skipped = new Set(overrides.skipped ?? []);
  const moved = new Map((overrides.moved ?? []).map((m) => [m.from, m.to]));
  let created = 0;
  for (const o of occ) {
    const key = o.startsAt.toISOString();
    let start = o.startsAt;
    let end = o.endsAt;
    let exception = false;
    const moveTarget = moved.get(key);
    if (moveTarget) {
      const dur = end.getTime() - start.getTime();
      start = new Date(moveTarget);
      end = new Date(start.getTime() + dur);
      exception = true;
    }
    if (skipped.has(key)) continue;
    if (holidayMatches(holidays, start)) continue;
    const exists = await tx.eventOccurrence.findFirst({ where: { eventId: event.id, startsAt: start } });
    if (exists) continue;
    await tx.eventOccurrence.create({
      data: { orgId: event.orgId, eventId: event.id, startsAt: start, endsAt: end, exception },
    });
    created++;
  }
  return { materialized: created };
}

export async function createEvent(ctx: Ctx, input: unknown) {
  const data = eventSchema.parse(input);
  await assertWritable(ctx.orgId);
  await requireCalendarWrite(ctx, data.calendarId);
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid dates");
  if (endsAt <= startsAt) throw new AppError(ErrorCodes.VALIDATION, "endsAt must be after startsAt");
  const type = data.patternId ? "SERIES_MASTER" : "SINGLE";
  const cfgRow = await db.temporalConfiguration.findUnique({ where: { orgId: ctx.orgId } });
  const horizon = data.materializeDays ?? cfgRow?.materializeHorizonDays ?? 90;
  const ev = await db.$transaction(async (tx) => {
    const created = await tx.scheduledEvent.create({
      data: {
        orgId: ctx.orgId,
        calendarId: data.calendarId,
        patternId: data.patternId ?? null,
        title: data.title,
        description: data.description ?? null,
        type: type as never,
        startsAt,
        endsAt,
        allDay: data.allDay,
        timezone: data.timezone,
        location: data.location ?? null,
        capacity: data.capacity,
        metadata: data.metadata as object,
        createdById: ctx.userId,
        attendees: {
          create: (data.attendees ?? []).map((a) => ({
            orgId: ctx.orgId,
            kind: a.kind as never,
            refId: a.refId ?? null,
            email: a.email ?? null,
            name: a.name ?? null,
          })),
        },
      },
      include: { occurrences: true },
    });
    const mat = await materializeSeries(tx, created, horizon);
    await audit(tx, ctx, "event.created", undefined, created.id, { calendarId: created.calendarId, occurrences: mat.materialized });
    await emit(tx, { type: "event.created", aggregateType: "SCHEDULED_EVENT", aggregateId: created.id, orgId: ctx.orgId, payload: { title: created.title, series: !!data.patternId } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "EVENT", entityId: created.id, event: "ScheduleCreated", snapshot: created, payload: { occurrences: mat.materialized } });
    return { ...created, occurrencesMaterialized: mat.materialized };
  });
  return ev;
}

export async function listEvents(ctx: Ctx, params: URLSearchParams) {
  const calendarId = params.get("calendarId") ?? undefined;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  return db.scheduledEvent.findMany({
    where: {
      orgId: ctx.orgId,
      ...(calendarId ? { calendarId } : {}),
      ...(from || to ? { OR: [{ startsAt: from ? { gte: new Date(from) } : undefined }, { endsAt: to ? { lte: new Date(to) } : undefined }, { startsAt: { gte: from ?? new Date(0) }, endsAt: { lte: to ?? new Date(8640000000000000) } }] } : {}),
    },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { pattern: { select: { id: true, name: true, dsl: true } }, calendar: { select: { id: true, name: true, color: true } }, _count: { select: { occurrences: true } } },
  });
}

export async function getEvent(ctx: Ctx, id: string) {
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id }, include: { occurrences: { orderBy: { startsAt: "asc" }, take: 300 }, attendees: true } }), "Event", ctx.orgId);
  return ev;
}

/** Extend a series' horizon (cron-safe, idempotent). */
export async function extendEvent(ctx: Ctx, id: string, days?: number) {
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id } }), "Event", ctx.orgId);
  if (!ev.patternId) throw new AppError(ErrorCodes.VALIDATION, "Only recurring events have a horizon to extend");
  const res = await db.$transaction((tx) => materializeSeries(tx, ev, days ?? 90));
  await audit(db, ctx, "event.extended", undefined, id, { days: days ?? 90 });
  return res;
}

/** Cancel a single occurrence (adds skip-override; leaves the series intact). */
export async function cancelOccurrence(ctx: Ctx, occurrenceId: string, reason?: string) {
  const occ = await db.eventOccurrence.findUnique({ where: { id: occurrenceId }, include: { event: true } });
  if (!occ) throw new AppError(ErrorCodes.NOT_FOUND, "Occurrence not found");
  await requireCalendarWrite(ctx, occ.event.calendarId);
  if (occ.event.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Occurrence not found");
  await db.$transaction(async (tx) => {
    await tx.eventOccurrence.update({ where: { id: occurrenceId }, data: { status: "CANCELLED", exception: true } });
    if (occ.event.patternId) {
      const overrides = (occ.event.overrides ?? {}) as { skipped?: string[] };
      const skipped = new Set(overrides.skipped ?? []);
      skipped.add(occ.startsAt.toISOString());
      await tx.scheduledEvent.update({ where: { id: occ.eventId }, data: { overrides: { ...overrides, skipped: [...skipped] } as object } });
    }
    await audit(tx, ctx, "occurrence.cancelled", undefined, occ.eventId, { occurrenceId, reason: reason ?? null });
    await emit(tx, { type: "occurrence.cancelled", aggregateType: "SCHEDULED_EVENT", aggregateId: occ.eventId, orgId: ctx.orgId, payload: { at: occ.startsAt.toISOString() } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "EVENT", entityId: occ.eventId, event: "OccurrenceCancelled", payload: { occurrenceId, at: occ.startsAt } });
  });
  return { cancelled: true };
}

/** Move one occurrence (adds move-override; recomputes this instance only). */
export async function moveOccurrence(ctx: Ctx, occurrenceId: string, startsAt: string, endsAt?: string) {
  const parsed = z.object({ occurrenceId: z.string().min(1), startsAt: z.string().min(10), endsAt: z.string().min(10).optional() }).parse({ occurrenceId, startsAt, endsAt });
  const occ = await db.eventOccurrence.findUnique({ where: { id: parsed.occurrenceId }, include: { event: true } });
  if (!occ) throw new AppError(ErrorCodes.NOT_FOUND, "Occurrence not found");
  if (occ.event.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Occurrence not found");
  await requireCalendarWrite(ctx, occ.event.calendarId);
  const newStart = new Date(parsed.startsAt);
  if (Number.isNaN(newStart.getTime())) throw new AppError(ErrorCodes.VALIDATION, "Invalid date");
  const dur = occ.endsAt.getTime() - occ.startsAt.getTime();
  const newEnd = parsed.endsAt ? new Date(parsed.endsAt) : new Date(newStart.getTime() + dur);
  if (newEnd <= newStart) throw new AppError(ErrorCodes.VALIDATION, "end must be after start");
  await db.$transaction(async (tx) => {
    const dup = await tx.eventOccurrence.findFirst({ where: { eventId: occ.eventId, startsAt: newStart, id: { not: parsed.occurrenceId } } });
    if (dup) throw new AppError(ErrorCodes.CONFLICT, "That date already has an occurrence");
    await tx.eventOccurrence.update({ where: { id: parsed.occurrenceId }, data: { startsAt: newStart, endsAt: newEnd, exception: true, overridden: true } });
    if (occ.event.patternId) {
      const overrides = (occ.event.overrides ?? {}) as { moved?: Array<{ from: string; to: string }>; skipped?: string[] };
      const moved = [...(overrides.moved ?? []), { from: occ.startsAt.toISOString(), to: newStart.toISOString() }];
      await tx.scheduledEvent.update({ where: { id: occ.eventId }, data: { overrides: { ...overrides, moved } as object } });
    }
    await audit(tx, ctx, "occurrence.moved", undefined, occ.eventId, { from: occ.startsAt, to: newStart });
    await emit(tx, { type: "occurrence.moved", aggregateType: "SCHEDULED_EVENT", aggregateId: occ.eventId, orgId: ctx.orgId, payload: { from: occ.startsAt.toISOString(), to: newStart.toISOString() } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "EVENT", entityId: occ.eventId, event: "OccurrenceMoved", payload: { from: occ.startsAt, to: newStart } });
  });
  return { moved: true, startsAt: newStart, endsAt: newEnd };
}

export async function updateEvent(ctx: Ctx, id: string, input: unknown) {
  const data = eventPatchSchema.partial().omit({ calendarId: true, patternId: true, materializeDays: true, attendees: true }).parse(input);
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id } }), "Event", ctx.orgId);
  await requireCalendarWrite(ctx, ev.calendarId);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.scheduledEvent.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        status: data.status as never,
        location: data.location,
        capacity: data.capacity,
        metadata: data.metadata as object | undefined,
      },
    });
    await audit(tx, ctx, "event.updated", undefined, id);
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "EVENT", entityId: id, event: "ScheduleUpdated", snapshot: u });
    return u;
  });
  return updated;
}

export async function cancelEvent(ctx: Ctx, id: string) {
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id } }), "Event", ctx.orgId);
  if (ev.status === "CANCELLED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Already cancelled");
  await db.$transaction(async (tx) => {
    await tx.scheduledEvent.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.eventOccurrence.updateMany({ where: { eventId: id, status: { not: "COMPLETED" } }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "event.cancelled", undefined, id);
    await emit(tx, { type: "event.cancelled", aggregateType: "SCHEDULED_EVENT", aggregateId: id, orgId: ev.orgId });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "EVENT", entityId: id, event: "ScheduleCancelled" });
  });
  return { cancelled: true };
}

// ---------------------------------------------------------------------------
// agenda — cross-calendar materialized view
// ---------------------------------------------------------------------------

export type TimelineItem = {
  domain: "EVENT" | "APPOINTMENT" | "FLIGHT" | "PUBLISH" | "EMAIL" | "TASK" | "REPORT";
  id: string;
  title: string;
  start: string;
  end: string | null;
  status: string | null;
  source: string;
  color: string;
};

/** The platform's ONE monitored timeline: every scheduled thing, every domain, merged. */
export async function platformTimeline(ctx: Ctx, params: URLSearchParams): Promise<{ from: string; to: string; items: TimelineItem[] }> {
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const to = params.get("to") ? new Date(params.get("to") as string) : new Date(from.getTime() + 14 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new AppError(ErrorCodes.VALIDATION, "Invalid from/to");
  if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new AppError(ErrorCodes.VALIDATION, "Window exceeds 366 days");
  const agendaData = await agenda(ctx, new URLSearchParams({ from: from.toISOString(), to: to.toISOString() }));
  const items: TimelineItem[] = [
    ...agendaData.occurrences.map((o) => ({ domain: "EVENT" as const, id: o.id, title: o.title, start: o.startsAt.toISOString(), end: o.endsAt.toISOString(), status: null, source: o.calendar.name, color: o.calendar.color })),
    ...agendaData.appointments.map((a) => ({ domain: "APPOINTMENT" as const, id: a.id, title: a.title, start: a.startsAt.toISOString(), end: a.endsAt.toISOString(), status: a.status, source: "appointments", color: "#22c55e" })),
  ];
  const [flights, targets, emails, tasks, reports] = await Promise.all([
    db.campaignFlight.findMany({ where: { orgId: ctx.orgId, status: { in: ["DRAFT", "APPROVED", "LIVE", "PAUSED"] }, startsAt: { lte: to }, endsAt: { gte: from } }, include: { channel: { select: { name: true } }, campaign: { select: { name: true } } } }),
    db.contentTarget.findMany({ where: { orgId: ctx.orgId, status: "PENDING", scheduledAt: { gte: from, lte: to } }, include: { post: { select: { title: true } } }, take: 200 }),
    db.emailCampaign.findMany({ where: { orgId: ctx.orgId, status: "SCHEDULED", scheduledAt: { gte: from, lte: to } }, take: 100 }),
    db.task.findMany({ where: { orgId: ctx.orgId, status: { notIn: ["DONE", "CANCELLED"] }, dueDate: { gte: from, lte: to } }, take: 200 }),
    db.report.findMany({ where: { orgId: ctx.orgId, nextScheduledAt: { not: null, gte: from, lte: to } }, take: 100 }),
  ]);
  for (const f of flights) items.push({ domain: "FLIGHT", id: f.id, title: `Flight · ${f.campaign.name}`, start: f.startsAt.toISOString(), end: f.endsAt.toISOString(), status: f.status, source: f.channel.name, color: "#f59e0b" });
  for (const t of targets) items.push({ domain: "PUBLISH", id: t.id, title: `Publish · ${t.post.title.slice(0, 40)}`, start: t.scheduledAt.toISOString(), end: null, status: t.status, source: "content calendar", color: "#8b5cf6" });
  for (const e of emails) items.push({ domain: "EMAIL", id: e.id, title: `Send · ${e.subject}`, start: e.scheduledAt!.toISOString(), end: null, status: e.status, source: "email marketing", color: "#06b6d4" });
  for (const t of tasks) items.push({ domain: "TASK", id: t.id, title: t.title, start: t.dueDate!.toISOString(), end: null, status: t.status, source: "tasks", color: "#64748b" });
  for (const r of reports) items.push({ domain: "REPORT", id: r.id, title: `Report · ${r.name}`, start: r.nextScheduledAt!.toISOString(), end: null, status: "SCHEDULED", source: "reports", color: "#22c55e" });
  items.sort((a, b) => a.start.localeCompare(b.start));
  return { from: from.toISOString(), to: to.toISOString(), items };
}

/**
 * Centralization sweep: adopt every remaining legacy schedule in the
 * workspace into UTP temporal assets (flight cadence JSON, legacy report
 * enum). Idempotent; returns counts. After this, ONE authority holds all
 * recurrence logic.
 */
export async function adoptLegacySchedules(ctx: Ctx): Promise<{ flights: number; reports: number }> {
  let flights = 0;
  let reports = 0;
  // exhaustive: page through ALL legacy flights (never starve the newest)
  const legacyFlights: Array<Awaited<ReturnType<typeof db.campaignFlight.findMany>>[number]> = [];
  for (let page = 0; page < 10; page++) {
    const campaignBatch = await db.campaignFlight.findMany({ where: { orgId: ctx.orgId, patternId: null }, skip: page * 300, take: 300, orderBy: { startsAt: "asc" } });
    legacyFlights.push(...campaignBatch.filter((f) => Array.isArray((f.cadence as { days?: unknown[] } | null)?.days) && (f.cadence as { days: unknown[] }).days.length));
    if (campaignBatch.length < 300) break;
  }
  const { adoptFlightCadence } = await import("./calendar.service");
  for (const f of legacyFlights) {
    const cad = f.cadence as { days?: number[]; time?: string } | null;
    if (!cad?.days?.length) continue;
    const pattern = await adoptFlightCadence(ctx, f.id, ctx.orgId, `flight-${f.id.slice(-6)}`, cad, f.timezone);
    if (pattern) flights++;
  }
  const legacyReports = await db.report.findMany({ where: { orgId: ctx.orgId, patternId: null, schedule: { not: "NONE" } }, take: 500 });
  for (const r of legacyReports) {
    const { legacyScheduleSpec } = await import("./analytics.service");
    const spec = legacyScheduleSpec(r.schedule as string);
    if (!spec) continue;
    const pattern = await db.temporalPattern.create({
      data: {
        orgId: ctx.orgId,
        name: `Report schedule · ${r.name}`,
        type: "WINDOW",
        freq: spec.freq as never,
        spec: spec as object,
        dsl: `${{ DAILY: "EVERY DAY", WEEKLY: "EVERY MONDAY", MONTHLY: "EVERY MONTH 1ST" }[spec.freq] ?? "EVERY DAY"} ${(spec as { time?: string }).time ?? "08:00"}`,
        timezone: (await db.temporalConfiguration.findUnique({ where: { orgId: ctx.orgId } }))?.timezone ?? "UTC",
        createdById: ctx.userId,
      },
    });
    await db.report.update({ where: { id: r.id }, data: { patternId: pattern.id } });
    await audit(db, ctx, "report.pattern_adopted", undefined, r.id, { patternId: pattern.id });
    reports++;
  }
  await audit(db, ctx, "temporal.legacy_adopted", undefined, undefined, { flights, reports });
  return { flights, reports };
}

export async function agenda(ctx: Ctx, params: URLSearchParams) {
  const from = params.get("from") ? new Date(params.get("from") as string) : new Date();
  const to = params.get("to") ? new Date(params.get("to") as string) : new Date(from.getTime() + 14 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new AppError(ErrorCodes.VALIDATION, "Invalid from/to");
  if (to.getTime() - from.getTime() > 366 * 86_400_000) throw new AppError(ErrorCodes.VALIDATION, "Window exceeds 366 days");
  const shareable = new Set((await db.calendarShare.findMany({ where: { orgId: ctx.orgId, OR: [{ principalId: ctx.userId }, { principalType: "ORGANIZATION", principalId: ctx.orgId }, { principalType: "PUBLIC", principalId: "public" }] }, select: { calendarId: true } })).map((s) => s.calendarId));
  const owned = (await db.calendar.findMany({ where: { orgId: ctx.orgId, ownerUserId: ctx.userId }, select: { id: true } })).map((c) => c.id);
  const visible = new Set([...shareable, ...owned]);
  const [events, occurrences, appointments] = await Promise.all([
    db.scheduledEvent.findMany({
      where: { orgId: ctx.orgId, status: { not: "CANCELLED" } },
      select: { id: true, title: true, calendarId: true, type: true, capacity: true, status: true, timezone: true, calendar: { select: { name: true, color: true, archivedAt: true } } },
    }),
    db.eventOccurrence.findMany({ where: { orgId: ctx.orgId, startsAt: { gte: from }, endsAt: { lte: to }, status: { not: "CANCELLED" } }, orderBy: { startsAt: "asc" }, take: 1000 }),
    db.appointment.findMany({ where: { orgId: ctx.orgId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startsAt: { gte: from }, endsAt: { lte: to } }, take: 400 }),
  ]);
  const byId = new Map(events.map((e) => [e.id, e]));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    occurrences: occurrences
      .filter((o) => {
        const ev = byId.get(o.eventId);
        return ev && visible.has(ev.calendarId) && !ev.calendar.archivedAt;
      })
      .map((o) => {
        const ev = byId.get(o.eventId)!;
        const wall = utcToWall(o.startsAt, ev.timezone);
        return { id: o.id, eventId: o.eventId, title: ev.title, calendar: ev.calendar, startsAt: o.startsAt, endsAt: o.endsAt, local: `${String(wall.h).padStart(2, "0")}:${String(wall.mi).padStart(2, "0")}`, allDay: false };
      }),
    appointments: appointments.filter((a) => visible.has(a.calendarId)).map((a) => ({ id: a.id, title: `${a.attendeeName}${a.service ? ` · ${a.service}` : ""}`, calendar: { name: "appointment", color: "#22c55e" }, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status })),
  };
}

// ---------------------------------------------------------------------------
// dependencies
// ---------------------------------------------------------------------------

export async function createDependency(ctx: Ctx, input: unknown) {
  const data = dependencySchema.parse(input);
  await assertWritable(ctx.orgId);
  const lagMinutes = data.lagUnit === "MINUTES" ? data.lagValue : data.lagUnit === "HOURS" ? data.lagValue * 60 : data.lagValue * 1440;
  const dep = await db.temporalDependency.create({
    data: { orgId: ctx.orgId, scope: data.scope as never, fromType: data.fromType, fromId: data.fromId, toType: data.toType, toId: data.toId, type: data.type as never, lagValue: lagMinutes, lagUnit: "MINUTES" },
  });
  await audit(db, ctx, "dependency.created", undefined, dep.id, { edge: `${data.fromId}→${data.toId}` });
  await emit(db, { type: "dependency.created", aggregateType: "TEMPORAL_DEPENDENCY", aggregateId: dep.id, orgId: ctx.orgId });
  return dep;
}

export async function listDependencies(ctx: Ctx, eventId?: string) {
  return db.temporalDependency.findMany({
    where: { orgId: ctx.orgId, ...(eventId ? { OR: [{ fromId: eventId }, { toId: eventId }] } : {}) },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
}

export async function deleteDependency(ctx: Ctx, id: string) {
  const dep = await requireOwned(await db.temporalDependency.findUnique({ where: { id } }), "Dependency", ctx.orgId);
  await db.temporalDependency.delete({ where: { id } });
  await audit(db, ctx, "dependency.deleted", undefined, dep.id);
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export const temporalConfigSchema = z.object({
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  timeSystemCode: z.string().trim().max(40).default("UTC"),
  weekStartsOn: z.number().int().min(0).max(6).default(1),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  defaultCapacity: z.number().int().min(1).max(10000).default(1),
  retentionDays: z.number().int().min(0).max(36500).default(0),
  materializeHorizonDays: z.number().int().min(7).max(730).default(90),
  businessRuleId: z.string().max(64).nullable().optional(),
  holidayCalendarId: z.string().max(64).nullable().optional(),
  fiscalCalendarId: z.string().max(64).nullable().optional(),
});

export async function getTemporalConfig(ctx: Ctx) {
  const existing = await db.temporalConfiguration.findUnique({ where: { orgId: ctx.orgId } });
  if (existing) return existing;
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } });
  return {
    orgId: ctx.orgId,
    timezone: org.timezone,
    timeSystemCode: "UTC",
    weekStartsOn: 1,
    workingDays: [1, 2, 3, 4, 5],
    defaultCapacity: 1,
    retentionDays: 0,
    materializeHorizonDays: 90,
    businessRuleId: null,
    holidayCalendarId: null,
    fiscalCalendarId: null,
    settings: {},
    createdAt: null,
    updatedAt: null,
  };
}

export async function updateTemporalConfig(ctx: Ctx, input: unknown) {
  const data = temporalConfigSchema.parse(input);
  if (data.businessRuleId) {
    const r = await requireOwned(await db.temporalRule.findUnique({ where: { id: data.businessRuleId } }), "Rule", ctx.orgId);
    if (r.type !== "BUSINESS_HOURS" && r.type !== "WORKING_DAYS") throw new AppError(ErrorCodes.VALIDATION, "businessRuleId must point to a BUSINESS_HOURS/WORKING_DAYS rule");
  }
  const cfg = await db.temporalConfiguration.upsert({
    where: { orgId: ctx.orgId },
    create: { orgId: ctx.orgId, ...data, settings: {} },
    update: data,
  });
  await audit(db, ctx, "temporal.config_updated", undefined, cfg.id, { timezone: cfg.timezone });
  await emit(db, { type: "config.updated", aggregateType: "TEMPORAL_CONFIG", aggregateId: cfg.id, orgId: ctx.orgId });
  return cfg;
}

/** compilePattern re-export for tests/consumers. */
export { compilePattern };

export async function deletePattern(ctx: Ctx, id: string) {
  const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id }, include: { _count: { select: { events: true, calendars: true } } } }), "Pattern", ctx.orgId);
  if (pat._count.events + pat._count.calendars > 0) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Pattern is consumed by ${pat._count.events} event(s)/${pat._count.calendars} calendar(s); deprecate instead`);
  if (pat.isLibrary) throw new AppError(ErrorCodes.FORBIDDEN, "Library patterns cannot be deleted by workspaces");
  await db.$transaction(async (tx) => {
    await tx.temporalPattern.delete({ where: { id } });
    await audit(tx, ctx, "pattern.deleted", undefined, id);
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "PATTERN", entityId: id, event: "PatternDeleted" });
  });
  return { deleted: true };
}

/** Cron sweep: extend materialization for all recurring events to horizon. */
export async function sweepMaterialize(): Promise<{ eventsSwept: number; occurrencesCreated: number }> {
  const now = new Date();
  const series = await db.scheduledEvent.findMany({
    where: { type: "SERIES_MASTER", status: { not: "CANCELLED" }, patternId: { not: null } },
    include: { occurrences: { orderBy: { startsAt: "desc" }, take: 1 } },
    take: 300,
  });
  let occurrencesCreated = 0;
  let eventsSwept = 0;
  for (const ev of series) {
    const last = ev.occurrences[0];
    const cfg = await db.temporalConfiguration.findUnique({ where: { orgId: ev.orgId } });
    const horizon = (cfg?.materializeHorizonDays ?? 90) * 86_400_000;
    if (last && last.startsAt.getTime() > now.getTime() + horizon - 7 * 86_400_000) continue;
    try {
      const res = await db.$transaction((tx) => materializeSeries(tx, { ...ev, overrides: ev.overrides ?? {} }, (cfg?.materializeHorizonDays ?? 90)));
      occurrencesCreated += res.materialized;
      eventsSwept++;
    } catch { /* one bad series must not stop the sweep */ }
  }
  await db.systemSetting.upsert({
    where: { key: "cron:temporal-materialize" },
    create: { key: "cron:temporal-materialize", value: { at: now.toISOString(), eventsSwept, occurrencesCreated } },
    update: { value: { at: now.toISOString(), eventsSwept, occurrencesCreated } },
  });
  return { eventsSwept, occurrencesCreated };
}

// ---------------------------------------------------------------------------
// Schedule health monitor — one endpoint watching EVERY centralized schedule
// ---------------------------------------------------------------------------

export type ScheduleHealth = {
  score: number;
  crons: Array<{ key: string; at: string | null; ageHours: number | null }>;
  pastDueTriggers: Array<{ id: string; name: string; nextFireAt: string | null }>;
  failingTriggers: Array<{ id: string; name: string; recentFailures: number }>;
  deprecatedInUse: Array<{ id: string; name: string; consumers: number }>;
  staleSeries: Array<{ id: string; title: string; lastAt: string | null }>;
  oversubscribedResources: Array<{ id: string; name: string }>;
  dueReports: number;
};

export async function monitorSchedule(ctx: Ctx): Promise<ScheduleHealth> {
  const now = new Date();
  const [settings, pastDue, failingGrouped, deprecated, series, resources, dueReports] = await Promise.all([
    db.systemSetting.findMany({ where: { key: { startsWith: "cron:" } }, select: { key: true, value: true } }),
    db.temporalTrigger.findMany({ where: { orgId: ctx.orgId, status: "ARMED", nextFireAt: { lt: new Date(now.getTime() - 15 * 60_000) } }, select: { id: true, name: true, nextFireAt: true }, take: 20 }),
    db.temporalTriggerFire.groupBy({ by: ["triggerId"], _count: true, where: { orgId: ctx.orgId, outcome: { in: ["FAILED", "DEAD_LETTER", "RETRYING"] }, firedAt: { gte: new Date(now.getTime() - 7 * 86400_000) } }, having: { triggerId: { _count: { gte: 2 } } } }),
    db.temporalPattern.findMany({
      where: { status: "DEPRECATED", OR: [{ orgId: ctx.orgId }, { orgId: null }] },
      select: { id: true, name: true, _count: { select: { events: true, flights: true, reports: true, calendars: true, availabilityProfiles: true, triggers: true } } },
      take: 50,
    }),
    db.scheduledEvent.findMany({
      where: { orgId: ctx.orgId, type: "SERIES_MASTER", status: { not: "CANCELLED" } },
      select: { id: true, title: true, occurrences: { where: { status: { not: "CANCELLED" } }, orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } } },
      take: 200,
    }),
    db.resource.findMany({ where: { orgId: ctx.orgId, active: true }, select: { id: true, name: true, capacity: true } }),
    db.report.count({ where: { orgId: ctx.orgId, nextScheduledAt: { not: null, lt: new Date(now.getTime() - 3_600_000) } } }),
  ]);

  const crons = settings.map((c) => {
    const at = (c.value as { at?: string } | null)?.at ?? null;
    return { key: c.key, at, ageHours: at ? Math.round(((now.getTime() - new Date(at).getTime()) / 3_600_000) * 10) / 10 : null };
  });
  const failingNames = failingGrouped.length
    ? await db.temporalTrigger.findMany({ where: { id: { in: failingGrouped.map((f) => f.triggerId) } }, select: { id: true, name: true } })
    : [];
  const failingMap = new Map(failingNames.map((t) => [t.id, t.name]));
  const staleSeries = series
    .map((e) => ({ id: e.id, title: e.title, lastAt: e.occurrences[0]?.startsAt?.toISOString() ?? null }))
    .filter((e) => !e.lastAt || new Date(e.lastAt) < now);
  const deprecatedInUse = deprecated
    .map((p) => ({ id: p.id, name: p.name, consumers: Object.values(p._count).reduce((a, b) => a + b, 0) }))
    .filter((p) => p.consumers > 0);

  // capacity pressure: any overlapping pair beyond capacity on a resource
  const oversubscribedResources: Array<{ id: string; name: string }> = [];
  if (resources.length) {
    const bookings = await db.resourceBooking.findMany({
      where: { orgId: ctx.orgId, resourceId: { in: resources.map((r) => r.id) }, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { gte: now } },
      select: { resourceId: true, startsAt: true, endsAt: true, quantity: true },
      take: 3000,
    });
    const byRes = new Map<string, typeof bookings>();
    for (const b of bookings) (byRes.get(b.resourceId) ?? byRes.set(b.resourceId, []).get(b.resourceId)!).push(b);
    for (const r of resources) {
      const list = (byRes.get(r.id) ?? []).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      let over = false;
      for (const probe of list) {
        const overlap = list.filter((x) => x.startsAt < probe.endsAt && probe.startsAt < x.endsAt);
        if (overlap.reduce((a, x) => a + x.quantity, 0) > r.capacity) {
          over = true;
          break;
        }
      }
      if (over) oversubscribedResources.push({ id: r.id, name: r.name });
    }
  }

  const staleCrons = crons.filter((c) => c.at && (c.ageHours ?? 0) > 26).length + crons.filter((c) => !c.at).length;
  const warnings = pastDue.length + failingMap.size + deprecatedInUse.length + staleSeries.length + oversubscribedResources.length + dueReports + Math.min(5, staleCrons);
  const score = Math.max(0, 100 - warnings * 10);
  return {
    score,
    crons: crons.sort((a, b) => a.key.localeCompare(b.key)),
    pastDueTriggers: pastDue.map((t) => ({ id: t.id, name: t.name, nextFireAt: t.nextFireAt?.toISOString() ?? null })),
    failingTriggers: failingGrouped.map((f) => ({ id: f.triggerId, name: failingMap.get(f.triggerId) ?? "—", recentFailures: f._count })),
    deprecatedInUse,
    staleSeries: staleSeries.slice(0, 10),
    oversubscribedResources,
    dueReports,
  };
}
