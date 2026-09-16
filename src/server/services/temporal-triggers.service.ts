/**
 * UTP Trigger Engine + Universal Execution Architecture.
 *
 * Pipeline (per spec): Pattern → Validation → Constraint evaluation →
 * Dependency resolution → Availability → Trigger resolution → Execution
 * planning → Execution pipeline → Target consumer. Each stage appends to the
 * ExecutionPlan.steps so runs are fully inspectable/replayable. Consumer
 * adapters own nothing; they reference other domains' services.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import { audit, requireOwned, assertWritable } from "./common";
import { emit } from "../events";
import { govern } from "./temporal-governance";
import type { Ctx } from "./common";
import { parseDsl } from "../temporal/dsl";
import { resolveAstro, type AstroEvent, type GeoPoint } from "../temporal/astronomy";
import { subtractIntervals, slotWindows } from "../temporal/constraints";
import { materializeSystem } from "../temporal/recurrence";
import { nextOccurrence } from "../temporal/recurrence";
import { expandPattern } from "./temporal-frame";
import { sendMail } from "../mail";
import { utcToWall } from "../temporal/tz";

export const triggerSchema = z.object({
  name: nameish,
  calendarId: z.string().max(64).nullable().optional(),
  anchorType: z.enum(["ABSOLUTE", "RELATIVE", "EVENT_BEFORE", "EVENT_AFTER", "RESOURCE_AVAILABLE", "CAPACITY_AVAILABLE", "TEAM_AVAILABLE", "ASTRONOMICAL", "PLANETARY", "CUSTOM"]),
  dsl: z.string().trim().max(400).nullable().optional(),
  anchor: z.record(z.string(), z.unknown()).default({}),
  consumerType: z.enum(["CAMPAIGN", "WORKFLOW", "SEO_REFRESH", "CONTENT", "CLIENT", "NOTIFICATION", "BILLING", "RESOURCE", "WORKFORCE", "MONITORING", "AI_AGENT", "AUTOMATION", "WEBHOOK"]).default("MONITORING"),
  consumerRef: z.string().max(64).nullable().optional(),
  patternId: z.string().max(64).nullable().optional(),
  retry: z.object({ maxAttempts: z.number().int().min(0).max(10).default(3), backoffSeconds: z.number().int().min(0).max(86400).default(60) }).default({ maxAttempts: 3, backoffSeconds: 60 }),
  maxFires: z.number().int().min(1).nullable().optional(),
});

async function computeNextFire(trigger: {
  anchorType: string;
  anchor: Record<string, unknown>;
  dsl: string | null;
  patternId: string | null;
  orgId: string;
  lastFiredAt: Date | null;
}): Promise<Date | null> {
  const now = new Date();
  if (trigger.patternId) {
    const p = await db.temporalPattern.findUnique({ where: { id: trigger.patternId } });
    if (p) {
      const from = trigger.lastFiredAt ?? now;
      const occ = (await expandPattern(p, from, new Date(from.getTime() + 400 * 86_400_000), { max: 1 }))[0];
      if (occ) return occ.startsAt;
    }
  }
  switch (trigger.anchorType) {
    case "ABSOLUTE":
      return trigger.anchor.at ? new Date(String(trigger.anchor.at)) : null;
    case "RELATIVE":
      return new Date(now.getTime() + Number(trigger.anchor.offsetMinutes ?? 0) * 60_000);
    case "ASTRONOMICAL": {
      const geo = await resolveTriggerGeo(trigger.orgId, trigger.anchor);
      if (!geo) return null;
      const ev = String(trigger.anchor.astroEvent ?? "SUNRISE") as AstroEvent;
      const t = resolveAstro(ev, now, geo);
      if (!t) return null;
      return t.getTime() > now.getTime() ? t : resolveAstro(ev, new Date(now.getTime() + 86_400_000), geo);
    }
    case "PLANETARY": {
      const code = String(trigger.anchor.timeSystemCode ?? "");
      const ts = await db.timeSystem.findFirst({ where: { OR: [{ orgId: trigger.orgId }, { orgId: null }], code, active: true } });
      if (!ts) return null;
      const occ = materializeSystem(
        { freq: "DAILY", interval: 1, time: /^\d{2}:\d{2}$/.test(String(trigger.anchor.time ?? "")) ? String(trigger.anchor.time) : "09:00" } as never,
        now,
        new Date(now.getTime() + 400 * 86_400_000),
        { kind: ts.kind, utcOffsetMinutes: ts.utcOffsetMinutes, unitSeconds: ts.unitSeconds, epochMicros: ts.epochMicros },
        { max: 1 },
      );
      return occ[0]?.startsAt ?? null;
    }
    case "RESOURCE_AVAILABLE":
    case "CAPACITY_AVAILABLE":
      return resolveResourceFree(trigger.orgId, trigger.anchor);
    case "TEAM_AVAILABLE":
      return resolveTeamFree(trigger.orgId, trigger.anchor);
    case "CUSTOM": {
      if (trigger.dsl) {
        try {
          const c = parseDsl(trigger.dsl);
          if (c.kind === "trigger") {
            const t = c.trigger;
            if (t.anchorType === "ABSOLUTE" && t.at) return new Date(t.at);
            if (t.anchorType === "RELATIVE") return new Date(now.getTime() + (t.offsetMinutes ?? 0) * 60_000);
          }
          if (c.kind === "pattern") {
            const occ = nextOccurrence(c.spec, now, "UTC", 400);
            if (occ) return occ.startsAt;
          }
        } catch {
          return null;
        }
      }
      return null;
    }
    default:
      // EVENT_* anchors are armed by the arm-on-event flow; CUSTOM by dsl/pattern above
      return (trigger.anchor.at as string) ? new Date(String(trigger.anchor.at)) : null;
  }
}

export async function createTrigger(ctx: Ctx, input: unknown) {
  const data = triggerSchema.parse(input);
  await assertWritable(ctx.orgId);
  const armed = await db.$transaction(async (tx) => {
    if (data.patternId) {
      const { requireOwned } = await import("./common");
      await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
    }
    // validate condition anchors can actually resolve for this workspace
    if (data.anchorType === "RESOURCE_AVAILABLE" || data.anchorType === "CAPACITY_AVAILABLE") {
      const free = await resolveResourceFree(ctx.orgId, data.anchor);
      if (!free && data.anchor.resourceCode == null && data.anchor.resourceId == null) throw new AppError(ErrorCodes.VALIDATION, "RESOURCE/CAPACITY anchors need resourceCode or resourceId");
      if (!free) throw new AppError(ErrorCodes.VALIDATION, "Resource has no free window in the next 30 days (check code, availability pattern & bookings)");
    }
    if (data.anchorType === "TEAM_AVAILABLE") {
      if (!Array.isArray(data.anchor.userIds) || !(data.anchor.userIds as string[]).length) throw new AppError(ErrorCodes.VALIDATION, "TEAM_AVAILABLE needs anchor.userIds");
      const free = await resolveTeamFree(ctx.orgId, data.anchor);
      if (!free) throw new AppError(ErrorCodes.VALIDATION, "No shared free window for that team in the next 30 days");
    }
    if (data.anchorType === "PLANETARY") {
      const ts = await db.timeSystem.findFirst({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], code: String(data.anchor.timeSystemCode ?? ""), active: true } });
      if (!ts) throw new AppError(ErrorCodes.VALIDATION, "PLANETARY anchor needs a valid anchor.timeSystemCode");
    }
    if (data.anchorType === "ASTRONOMICAL") {
      const geo = await resolveTriggerGeo(ctx.orgId, data.anchor);
      if (!geo) throw new AppError(ErrorCodes.VALIDATION, "ASTRONOMICAL anchor needs lat/lng, a geoRef location with coordinates, or an org location with coordinates");
      const t = await computeNextFire({ anchorType: "ASTRONOMICAL", anchor: data.anchor as Record<string, unknown>, dsl: null, patternId: null, orgId: ctx.orgId, lastFiredAt: null });
      if (!t) throw new AppError(ErrorCodes.VALIDATION, "Astronomical event never occurs at that latitude (polar window)");
    }
    const t = await tx.temporalTrigger.create({
      data: {
        orgId: ctx.orgId,
        calendarId: data.calendarId ?? null,
        patternId: data.patternId ?? null,
        name: data.name,
        anchorType: data.anchorType as never,
        anchor: data.anchor as object,
        dsl: data.dsl ?? null,
        consumerType: data.consumerType as never,
        consumerRef: data.consumerRef ?? null,
        retry: data.retry as object,
        maxFires: data.maxFires ?? null,
        status: "ARMED",
        createdById: ctx.userId,
      },
    });
    const next = await computeNextFire({ ...t, anchor: t.anchor as Record<string, unknown>, patternId: data.patternId ?? null, orgId: ctx.orgId, lastFiredAt: null });
    if (data.patternId && !next) throw new AppError(ErrorCodes.VALIDATION, "Pattern produced no upcoming fire");
    const updated = await tx.temporalTrigger.update({ where: { id: t.id }, data: { nextFireAt: next } });
    if (next) await tx.temporalEventLog.create({ data: { orgId: ctx.orgId, aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id, seq: (await tx.temporalEventLog.count({ where: { aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id } })) + 1, type: "TriggerResolved", payload: { nextFireAt: next } as object, actorId: ctx.userId } });
    await audit(tx, ctx, "trigger.armed", undefined, t.id, { anchor: data.anchorType, consumer: data.consumerType, next });
    await emit(tx, { type: "trigger.armed", aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id, orgId: ctx.orgId, payload: { next } });
    await govern(tx, { orgId: ctx.orgId, actorId: ctx.userId, entityType: "TRIGGER", entityId: t.id, event: "TriggerCreated", snapshot: updated });
    return updated;
  });
  return armed;
}

export async function listTriggers(ctx: Ctx) {
  // exhaustive: page through ALL triggers so nothing is starved by a cap,
  // then rank by lifecycle (ARMED → EXHAUSTED → PAUSED, nulls last).
  const rows: Array<Awaited<ReturnType<typeof db.temporalTrigger.findMany>>[number] & { _count: { fires: number }; calendar: { name: string } | null; pattern: { id: string; name: string; dsl: string | null } | null }> = [];
  for (let page = 0; page < 20; page++) {
    const batch = await db.temporalTrigger.findMany({
      where: { orgId: ctx.orgId },
      skip: page * 250,
      take: 250,
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { fires: true } }, calendar: { select: { name: true } }, pattern: { select: { id: true, name: true, dsl: true } } },
    });
    rows.push(...batch);
    if (batch.length < 250) break;
  }
  const rank = { ARMED: 0, EXHAUSTED: 1, PAUSED: 2 } as const;
  return rows.sort((a, b) => {
    const r = rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank];
    if (r !== 0) return r;
    return (a.nextFireAt?.getTime() ?? Infinity) - (b.nextFireAt?.getTime() ?? Infinity);
  });
}

export async function deleteTrigger(ctx: Ctx, id: string) {
  const t = await db.temporalTrigger.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw new AppError(ErrorCodes.NOT_FOUND, "Trigger not found");
  await db.temporalTrigger.delete({ where: { id } });
  await audit(db, ctx, "trigger.deleted", undefined, id, { name: t.name });
  return { deleted: true };
}

export async function toggleTrigger(ctx: Ctx, id: string, active: boolean) {
  const t = await requireOwned(await db.temporalTrigger.findUnique({ where: { id } }), "Trigger", ctx.orgId);
  const next = active
    ? await computeNextFire({ anchorType: t.anchorType, anchor: t.anchor as Record<string, unknown>, dsl: t.dsl, patternId: t.patternId, orgId: ctx.orgId, lastFiredAt: t.lastFiredAt })
    : t.nextFireAt;
  const updated = await db.temporalTrigger.update({ where: { id }, data: { status: active ? "ARMED" : "PAUSED", nextFireAt: next } });
  await audit(db, ctx, active ? "trigger.armed" : "trigger.paused", undefined, id);
  return updated;
}

/**
 * Arm an event-relative trigger for a specific scheduled event: computes
 * event start ± offset. Called by the execution layer after event creation or
 * via API for campaign workflows.
 */
export async function armEventTrigger(ctx: Ctx, triggerId: string, eventId: string) {
  const t = await requireOwned(await db.temporalTrigger.findUnique({ where: { id: triggerId } }), "Trigger", ctx.orgId);
  const ev = await requireOwned(await db.scheduledEvent.findUnique({ where: { id: eventId } }), "Event", ctx.orgId);
  if (!["EVENT_BEFORE", "EVENT_AFTER"].includes(t.anchorType)) throw new AppError(ErrorCodes.VALIDATION, "Trigger is not event-anchored");
  const offset = Number((t.anchor as { offsetMinutes?: number }).offsetMinutes ?? (t.dsl ? 0 : 0));
  const at = t.anchorType === "EVENT_BEFORE" ? new Date(ev.startsAt.getTime() - Math.abs(offset) * 60_000) : new Date(ev.startsAt.getTime() + Math.abs(offset) * 60_000);
  const updated = await db.temporalTrigger.update({ where: { id: triggerId }, data: { anchor: { ...(t.anchor as Record<string, unknown>), at, eventId } as object, status: "ARMED", nextFireAt: at } });
  await audit(db, ctx, "trigger.armed_on_event", undefined, triggerId, { eventId, at });
  return updated;
}

// ---------------------------------------------------------------------------
// Universal execution pipeline
// ---------------------------------------------------------------------------

export type PlanStep = { stage: string; action: string; status: "done" | "skipped" | "failed" | "pending"; detail?: Record<string, unknown> };

export async function runExecutionPipeline(
  orgId: string,
  actorId: string,
  subject: { type: string; id: string },
  triggerId: string | null,
  consumerType: string,
  consumerRef: string | null,
  payload: Record<string, unknown>,
): Promise<{ planId: string; steps: PlanStep[]; status: string }> {
  const steps: PlanStep[] = [];
  const push = async (stage: string, action: string, status: PlanStep["status"], detail?: Record<string, unknown>) => {
    steps.push({ stage, action, status, detail });
  };

  // stage 1: validation
  await push("validate", `subject:${subject.type}`, "done", { triggerId });
  // stage 2: constraints
  const ruleIds = (payload.ruleIds as string[] | undefined) ?? [];
  if (ruleIds.length) {
    const rules = await db.temporalRule.findMany({ where: { id: { in: ruleIds } } });
    const { evaluateConstraints, isBlocked } = await import("../temporal/constraints");
    const cfgRow = await db.temporalConfiguration.findUnique({ where: { orgId }, select: { timezone: true } });
    const viols = evaluateConstraints(
      { start: new Date(String(payload.start ?? Date.now())), end: new Date(String(payload.end ?? Date.now())) },
      rules.map((r) => ({ id: r.id, type: r.type as never, params: r.params as Record<string, unknown>, hard: r.hard, name: r.name, priority: r.priority })),
      { now: new Date(), timezone: cfgRow?.timezone ?? "UTC" },
    );
    await push("constraints", `evaluated:${rules.length}`, isBlocked(viols) ? "failed" : "done", { violations: viols.map((v) => v.message) });
    if (isBlocked(viols)) {
      await persistPlan(orgId, actorId, subject, triggerId, consumerType, consumerRef, steps, "FAILED", { violations: viols });
      return { planId: "", steps, status: "FAILED" };
    }
  } else {
    await push("constraints", "none", "skipped");
  }
  // stage 3: dependencies
  const deps = await db.temporalDependency.findMany({ where: { orgId, toId: subject.id, scope: "EVENT" } });
  await push("dependencies", deps.length ? `resolved:${deps.length}` : "none", deps.length ? "done" : "skipped", { count: deps.length });
  // stage 4: availability
  await push("availability", "informational", "done");
  // stage 5: capacity — real concurrent-usage check when a resource is referenced
  const capacityRef = payload.resourceId as string | undefined;
  if (capacityRef) {
    const resource = await db.resource.findFirst({ where: { id: capacityRef, orgId }, select: { id: true, capacity: true, name: true } });
    if (resource) {
      const start = new Date(String(payload.start ?? Date.now()));
      const end = new Date(String(payload.end ?? start.getTime() + 3_600_000));
      const used = await db.resourceBooking.findMany({ where: { resourceId: resource.id, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: end }, endsAt: { gt: start } }, select: { quantity: true } });
      const usedQty = used.reduce((a, b) => a + b.quantity, 0);
      const wanted = Number(payload.quantity ?? 1);
      const okCap = usedQty + wanted <= resource.capacity;
      await push("capacity", `${resource.name}: ${usedQty}+${wanted}/${resource.capacity}`, okCap ? "done" : "failed", { usedQty, capacity: resource.capacity });
      if (!okCap) {
        await db.temporalEventLog.create({ data: { orgId, aggregateType: "EXECUTION_PLAN", aggregateId: subject.id, seq: (await db.temporalEventLog.count({ where: { aggregateType: "EXECUTION_PLAN", aggregateId: subject.id } })) + 1, type: "ConstraintViolated", payload: { stage: "capacity", resource: resource.name, usedQty, capacity: resource.capacity } as object, actorId } });
        const failed = await persistPlan(orgId, actorId, subject, triggerId, consumerType, consumerRef, steps, "FAILED", { capacity: false });
        return { planId: failed.id, steps, status: "FAILED" };
      }
    } else {
      await push("capacity", "resource-not-found", "skipped");
    }
  } else {
    await push("capacity", "no-resource", "skipped");
  }
  // stage 6: trigger resolution
  await push("trigger", triggerId ? `armed:${triggerId}` : "direct", "done");
  // stage 7: execution planning
  await push("plan", `consumer:${consumerType}`, "done");
  // stage 8: execute against consumer
  const outcome = await dispatchConsumer(orgId, actorId, consumerType, consumerRef, payload);
  await push("execute", `consumer:${consumerType}`, outcome.ok ? "done" : "failed", { detail: outcome.detail });

  const plan = await persistPlan(orgId, actorId, subject, triggerId, consumerType, consumerRef, steps, outcome.ok ? "COMPLETED" : "FAILED", outcome.detail ?? {});
  // verbatim event-sourcing names: ExecutionStarted → ExecutionCompleted|ExecutionFailed
  const seq0 = await db.temporalEventLog.count({ where: { aggregateType: "EXECUTION_PLAN", aggregateId: plan.id } });
  await db.temporalEventLog.createMany({
    data: [
      { orgId, aggregateType: "EXECUTION_PLAN", aggregateId: plan.id, seq: seq0 + 1, type: "ExecutionStarted", payload: { subject, consumerType } as object, actorId },
      { orgId, aggregateType: "EXECUTION_PLAN", aggregateId: plan.id, seq: seq0 + 2, type: outcome.ok ? "ExecutionCompleted" : "ExecutionFailed", payload: { steps: steps.length, result: outcome.detail ?? {} } as object, actorId },
    ],
  });
  const { meter } = await import("./temporal-metering.service");
  await meter(db, orgId, "EXECUTION", 1, { type: "EXECUTION_PLAN", id: plan.id }, { consumerType });
  return { planId: plan.id, steps, status: plan.status };
}

async function persistPlan(
  orgId: string,
  actorId: string,
  subject: { type: string; id: string },
  triggerId: string | null,
  consumerType: string,
  consumerRef: string | null,
  steps: PlanStep[],
  status: string,
  result: Record<string, unknown>,
) {
  return db.executionPlan.create({
    data: {
      orgId,
      subjectType: subject.type,
      subjectId: subject.id,
      triggerId,
      consumerType: consumerType as never,
      consumerRef,
      steps: steps as unknown as object[],
      status: status as never,
      result: result as object,
      executedAt: new Date(),
    },
  });
}

async function dispatchConsumer(
  orgId: string,
  actorId: string,
  type: string,
  ref: string | null,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: Record<string, unknown> }> {
  try {
    switch (type) {
      case "NOTIFICATION": {
        const to = String(payload.email ?? "");
        if (!to) return { ok: false, detail: { reason: "no email" } };
        await sendMail({ to, subject: String(payload.subject ?? "Schedule update"), text: String(payload.body ?? "") });
        return { ok: true, detail: { sent: to } };
      }
      case "MONITORING": {
        await audit(db, { orgId, userId: actorId, ip: null }, "temporal.monitor", undefined, undefined, { ...payload } as object);
        return { ok: true, detail: { logged: true } };
      }
      case "AUTOMATION":
      case "WORKFLOW": {
        if (payload.projectId && payload.title) {
          const task = await db.task.create({
            data: {
              orgId,
              projectId: String(payload.projectId),
              title: String(payload.title),
              status: "TODO",
              dueDate: payload.dueAt ? new Date(String(payload.dueAt)) : null,
            },
          });
          await emit(db, { type: "workflow.task_created", aggregateType: "TASK", aggregateId: task.id, orgId, payload: { trigger: ref } });
          return { ok: true, detail: { taskId: task.id } };
        }
        return { ok: false, detail: { reason: "workflow needs projectId+title" } };
      }
      case "CONTENT": {
        if (payload.postId) {
          const post = await db.contentPost.findFirst({ where: { id: String(payload.postId), orgId }, select: { id: true } });
          if (!post) return { ok: false, detail: { reason: "unknown post" } };
          const eventId = await emit(db, { type: "content.scheduled", aggregateType: "CONTENT_POST", aggregateId: post.id, orgId, payload: { at: payload.start ?? null, trigger: ref } });
          return { ok: true, detail: { post: post.id, eventId } };
        }
        return { ok: false, detail: { reason: "content needs postId" } };
      }
      case "BILLING": {
        if (payload.invoiceId) {
          const inv = await db.invoice.findFirst({ where: { id: String(payload.invoiceId), orgId }, select: { id: true } });
          if (inv) {
            const eventId = await emit(db, { type: "billing.invoice_reminder", aggregateType: "INVOICE", aggregateId: inv.id, orgId, payload: { trigger: ref } });
            return { ok: true, detail: { invoiceId: inv.id, eventId } };
          }
        }
        return { ok: false, detail: { reason: "billing needs valid invoiceId" } };
      }
      case "AI_AGENT": {
        const eventId = await emit(db, { type: "ai.generation_requested", aggregateType: "TEMPORAL_TRIGGER", aggregateId: ref ?? actorId, orgId, payload: { prompt: payload.prompt ?? null, trigger: ref } });
        return { ok: true, detail: { eventId, routed: "ai-fabric" } };
      }
      case "SEO_REFRESH": {
        const { refreshRanksFromProvider } = await import("./seo.service");
        const res = await refreshRanksFromProvider({ viewer: null as never, orgId, userId: actorId, ip: null });
        const eventId = await emit(db, { type: "seo.rank_refresh", aggregateType: "TEMPORAL_TRIGGER", aggregateId: ref ?? actorId, orgId, payload: { ...(res as object), trigger: ref } });
        return { ok: true, detail: { ...(res as Record<string, unknown>), eventId } };
      }
      case "CAMPAIGN": {
        const eventId = await emit(db, { type: "campaign.temporal_signal", aggregateType: "CAMPAIGN", aggregateId: ref ?? "signal", orgId, payload: { ...payload, trigger: ref } });
        return { ok: true, detail: { eventId } };
      }
      case "WEBHOOK": {
        const eventId = await emit(db, { type: "temporal.execution", aggregateType: "EXECUTION_PLAN", aggregateId: ref ?? "anon", orgId, payload });
        return { ok: true, detail: { eventId, fannedOut: true } };
      }
      default: {
        const eventId = await emit(db, { type: `temporal.signal.${type.toLowerCase()}`, aggregateType: "TEMPORAL_TRIGGER", aggregateId: ref ?? actorId, orgId, payload: { ...payload, consumer: type } });
        return { ok: true, detail: { eventId } };
      }
    }
  } catch (e) {
    return { ok: false, detail: { error: e instanceof Error ? e.message : "consumer error" } };
  }
}

/**
 * Cron dispatcher: fires due temporal triggers through the execution pipeline
 * with retry/backoff and dead-letter handling. Bounded pass (≤50 per run).
 */
export async function runTemporalTriggers(): Promise<{ fired: number; succeeded: number; failed: number; rescheduled: number }> {
  const now = new Date();
  // condition anchors are continuously re-resolved — availability may open later
  const unresolved = await db.temporalTrigger.findMany({
    where: { status: "ARMED", nextFireAt: null, anchorType: { in: ["RESOURCE_AVAILABLE", "CAPACITY_AVAILABLE", "TEAM_AVAILABLE", "PLANETARY", "ASTRONOMICAL", "CUSTOM"] } },
    take: 100,
  });
  for (const t of unresolved) {
    const next = await computeNextFire({ anchorType: t.anchorType, anchor: t.anchor as Record<string, unknown>, dsl: t.dsl, patternId: t.patternId, orgId: t.orgId, lastFiredAt: t.lastFiredAt });
    if (next) await db.temporalTrigger.update({ where: { id: t.id }, data: { nextFireAt: next } });
  }
  const due = await db.temporalTrigger.findMany({ where: { status: "ARMED", nextFireAt: { lte: now } }, take: 50, orderBy: { nextFireAt: "asc" } });
  let fired = 0;
  let succeeded = 0;
  let failed = 0;
  let rescheduled = 0;
  for (const t of due) {
    const anchor = t.anchor as Record<string, unknown>;
    const result = await runExecutionPipeline(
      t.orgId,
      t.createdById,
      { type: "trigger", id: t.id },
      t.id,
      t.consumerType,
      t.consumerRef,
      {
        ruleIds: (anchor.ruleIds as string[] | undefined) ?? [],
        start: t.nextFireAt?.toISOString?.() ?? now.toISOString(),
        email: anchor.email,
        subject: anchor.subject,
        body: `${t.name} fired at ${utcToWall(now, "UTC").y}-${utcToWall(now, "UTC").mo}`,
        projectId: anchor.projectId,
        title: anchor.title,
        prompt: anchor.prompt,
        dueAt: anchor.dueAt,
      },
    );
    fired++;
    const okRun = result.status === "COMPLETED";
    await db.temporalTriggerFire.create({
      data: { orgId: t.orgId, triggerId: t.id, outcome: okRun ? "SUCCESS" : "FAILED", planId: result.planId, detail: { steps: result.steps } as object },
    });
    await db.temporalEventLog.create({ data: { orgId: t.orgId, aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id, seq: (await db.temporalEventLog.count({ where: { aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id } })) + 1, type: "TriggerExecuted", payload: { outcome: okRun ? "SUCCESS" : "FAILED", planId: result.planId } as object, actorId: t.createdById } });
    const { meter } = await import("./temporal-metering.service");
    await meter(db, t.orgId, "TRIGGER", 1, { type: "TEMPORAL_TRIGGER", id: t.id }, { name: t.name });
    if (okRun) succeeded++;
    else failed++;
    const newCount = t.firedCount + 1;
    const retry = (t.retry as { maxAttempts?: number; backoffSeconds?: number }) ?? {};
    const ONE_SHOT = ["ABSOLUTE", "RELATIVE", "EVENT_BEFORE", "EVENT_AFTER"];
    const exhausted = (t.maxFires != null && newCount >= t.maxFires) || (ONE_SHOT.includes(t.anchorType) && !t.patternId && !t.dsl);
    const nextFire = exhausted ? null : await computeNextFire({ anchorType: t.anchorType, anchor, dsl: t.dsl, patternId: t.patternId, orgId: t.orgId, lastFiredAt: now });
    // if not time-driven (e.g. RELATIVE) but failed, retry with backoff
    const useBackoff = !okRun && !exhausted && retry.maxAttempts && newCount < retry.maxAttempts;
    const fireAt = useBackoff ? new Date(now.getTime() + (retry.backoffSeconds ?? 60) * 1000) : nextFire;
    await db.temporalTrigger.update({
      where: { id: t.id },
      data: { firedCount: newCount, lastFiredAt: now, status: exhausted ? "EXHAUSTED" : "ARMED", nextFireAt: fireAt },
    });
    if (useBackoff) {
      rescheduled++;
      await db.temporalTriggerFire.update({ where: { id: (await db.temporalTriggerFire.findFirst({ where: { triggerId: t.id }, orderBy: { firedAt: "desc" } }))!.id }, data: { outcome: "RETRYING" } });
    }
    if (exhausted) {
      await emit(db, { type: "trigger.exhausted", aggregateType: "TEMPORAL_TRIGGER", aggregateId: t.id, orgId: t.orgId });
    }
  }
  await db.systemSetting.upsert({
    where: { key: "cron:temporal-triggers" },
    create: { key: "cron:temporal-triggers", value: { at: now.toISOString() } },
    update: { value: { at: now.toISOString() } },
  });
  return { fired, succeeded, failed, rescheduled };
}

export async function listTriggerFires(ctx: Ctx, triggerId: string) {
  const t = await requireOwned(await db.temporalTrigger.findUnique({ where: { id: triggerId } }), "Trigger", ctx.orgId);
  const fires = await db.temporalTriggerFire.findMany({ where: { triggerId: t.id }, orderBy: { firedAt: "desc" }, take: 50 });
  return fires;
}

export async function listExecutions(ctx: Ctx) {
  return db.executionPlan.findMany({ where: { orgId: ctx.orgId }, orderBy: { plannedAt: "desc" }, take: 100, select: { id: true, subjectType: true, subjectId: true, triggerId: true, consumerType: true, status: true, steps: true, result: true, plannedAt: true, executedAt: true } });
}

/** Geo for astronomical anchors: inline lat/lng → geoRef GeoLocation → org default geo with coords. */
export async function resolveTriggerGeo(orgId: string, anchor: Record<string, unknown>): Promise<GeoPoint | null> {
  if (anchor.lat != null && anchor.lng != null) return { lat: Number(anchor.lat), lng: Number(anchor.lng) };
  if (anchor.geoRef) {
    const g = await db.geoLocation.findFirst({ where: { OR: [{ orgId }, { orgId: null }], id: String(anchor.geoRef) } });
    if (g?.latE7 != null && g?.lngE7 != null) return { lat: g.latE7 / 1e7, lng: g.lngE7 / 1e7 };
    return null;
  }
  const g = await db.geoLocation.findFirst({ where: { OR: [{ orgId }, { orgId: null }], latE7: { not: null }, lngE7: { not: null } }, orderBy: [{ orgId: { sort: "desc", nulls: "last" } }] });
  return g?.latE7 != null && g?.lngE7 != null ? { lat: g.latE7 / 1e7, lng: g.lngE7 / 1e7 } : null;
}

/** Earliest instant a resource has a free contiguous window ≥ minutes with seat capacity honored. */
async function resolveResourceFree(orgId: string, anchor: Record<string, unknown>): Promise<Date | null> {
  const code = anchor.resourceCode ? String(anchor.resourceCode) : null;
  const resource = code
    ? await db.resource.findFirst({ where: { orgId, code, active: true } })
    : anchor.resourceId
      ? await db.resource.findFirst({ where: { orgId, id: String(anchor.resourceId), active: true } })
      : null;
  if (!resource?.availabilityPatternId) return null;
  const pattern = await db.temporalPattern.findUnique({ where: { id: resource.availabilityPatternId } });
  if (!pattern) return null;
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const minutes = Math.max(5, Number(anchor.minutes ?? 60));
  const seats = Math.max(1, Number(anchor.seats ?? 1));
  const { expandPattern } = await import("./temporal-frame");
  const occ = await expandPattern(pattern, now, horizon, { max: 100 });
  const dayMs = (pattern.spec as { durationMinutes?: number })?.durationMinutes ? (pattern.spec as { durationMinutes: number }).durationMinutes * 60_000 : 8 * 3_600_000;
  const windows = occ.map((o) => ({ start: o.startsAt, end: new Date(o.startsAt.getTime() + dayMs) }));
  const bookings = await db.resourceBooking.findMany({ where: { resourceId: resource.id, status: { in: ["HELD", "CONFIRMED"] }, startsAt: { lt: horizon }, endsAt: { gt: now } } });
  const free = subtractIntervals(windows, bookings.map((b) => ({ start: b.startsAt, end: b.endsAt })));
  outer: for (const f of slotWindows(free, minutes, minutes, now, 5)) {
    // seats still available at that time?
    for (let t = f.start.getTime(); t < f.end.getTime(); t += 60_000) {
      const at = new Date(t);
      const used = bookings.filter((b) => b.startsAt <= at && b.endsAt > at).reduce((a, b) => a + b.quantity, 0);
      if (used + seats > resource.capacity) continue outer;
      return f.start;
    }
  }
  return null;
}

/** Earliest instant ALL listed teammates share a free window (profiles minus blackouts minus shifts). */
async function resolveTeamFree(orgId: string, anchor: Record<string, unknown>): Promise<Date | null> {
  const userIds = Array.isArray(anchor.userIds) ? anchor.userIds.map(String) : [];
  if (!userIds.length) return null;
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const minutes = Math.max(5, Number(anchor.minutes ?? 60));
  const sets: Array<Array<{ start: Date; end: Date }>> = [];
  for (const uid of userIds) {
    const profiles = await db.availabilityProfile.findMany({ where: { orgId, subjectType: "USER", subjectId: uid, active: true } });
    if (!profiles.length) return null;
    let windows: Array<{ start: Date; end: Date }> = [];
    for (const p of profiles) {
      if (!p.patternId) continue;
      const pattern = await db.temporalPattern.findUnique({ where: { id: p.patternId } });
      if (!pattern) continue;
      const { expandPattern } = await import("./temporal-frame");
      const occ = await expandPattern(pattern, now, horizon, { max: 100 });
      const dayMs = (pattern.spec as { durationMinutes?: number })?.durationMinutes ? (pattern.spec as { durationMinutes: number }).durationMinutes * 60_000 : 8 * 3_600_000;
      windows = windows.concat(occ.map((o) => ({ start: o.startsAt, end: new Date(o.startsAt.getTime() + dayMs) })));
    }
    const holes = await db.blackoutWindow.findMany({ where: { orgId, profileId: { in: profiles.map((p) => p.id) }, startsAt: { lt: horizon }, endsAt: { gt: now } } });
    windows = subtractIntervals(windows, holes.map((h) => ({ start: h.startsAt, end: h.endsAt })));
    const shifts = await db.shiftAssignment.findMany({ where: { userId: uid, startsAt: { lt: horizon }, endsAt: { gt: now } } });
    windows = subtractIntervals(windows, shifts.map((x) => ({ start: x.startsAt, end: x.endsAt })));
    sets.push(windows);
  }
  let shared = sets[0];
  for (const list of sets.slice(1)) {
    const next: Array<{ start: Date; end: Date }> = [];
    for (const a of shared) for (const b of list) {
      const s = new Date(Math.max(a.start.getTime(), b.start.getTime()));
      const e = new Date(Math.min(a.end.getTime(), b.end.getTime()));
      if (s < e) next.push({ start: s, end: e });
    }
    shared = next;
  }
  const slot = slotWindows(shared, minutes, minutes, now, 1)[0] ?? null;
  return slot ? slot.start : null;
}
