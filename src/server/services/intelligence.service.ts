import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, codeish, dateSchema, moneySchema, nameish } from "../schemas";
import { toMinor } from "../money";
import type {
  AttributionModelKind,
  AttributionTouchKind,
  AutonomousMode,
  OptimizationKind,
} from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Intelligence: multi-touch attribution, funnels, conversion
// prediction, channel optimization and autonomous policies. Deterministic
// models only; no external calls. Campaign remains owned by the orchestrator.
// ===========================================================================

async function requireCampaign(ctx: Ctx, id: string) {
  return requireOwned(await db.campaign.findUnique({ where: { id } }), "Campaign", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const TOUCH_KINDS = ["IMPRESSION", "CLICK", "CONVERSION"] as const;

export const touchSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(TOUCH_KINDS),
  campaignId: z.string().max(64).nullable().optional(),
  trackedLinkId: z.string().max(64).nullable().optional(),
  channelCode: z.string().trim().max(40).nullable().optional(),
  value: moneySchema.default(0),
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
  at: dateSchema.optional(),
});

export async function recordTouch(ctx: Ctx, input: unknown) {
  const data = touchSchema.parse(input);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const row = await db.attributionTouch.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      trackedLinkId: data.trackedLinkId ?? null,
      subjectKey: data.subjectKey,
      channelCode: data.channelCode ?? null,
      kind: data.kind as AttributionTouchKind,
      valueMinor: toMinor(data.value),
      currencyCode: data.currencyCode,
      ...(data.at ? { at: new Date(data.at) } : {}),
    },
  });
  return row;
}

export const attributionSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  campaignId: z.string().max(64).nullable().optional(),
  model: z.enum(["LAST_TOUCH", "FIRST_TOUCH", "LINEAR", "POSITION_BASED", "TIME_DECAY", "CUSTOM"]).default("LAST_TOUCH"),
  lookbackDays: z.number().int().min(1).max(365).default(30),
});

/**
 * Compute credit allocation across a subject's touches. Models are explicit
 * and deterministic; positions are expressed in bps summing to 10000.
 */
export async function computeAttribution(ctx: Ctx, input: unknown) {
  const data = attributionSchema.parse(input);
  const since = new Date(Date.now() - data.lookbackDays * 86400_000);
  const touches = await db.attributionTouch.findMany({
    where: { orgId: ctx.orgId, subjectKey: data.subjectKey, at: { gte: since }, ...(data.campaignId ? { campaignId: data.campaignId } : {}) },
    orderBy: { at: "asc" },
  });
  if (touches.length === 0) throw new AppError(ErrorCodes.NOT_FOUND, "No touches in the lookback window");
  const n = touches.length;
  const weights: number[] = new Array(n).fill(0);
  switch (data.model) {
    case "FIRST_TOUCH":
      weights[0] = 10_000;
      break;
    case "LAST_TOUCH":
      weights[n - 1] = 10_000;
      break;
    case "LINEAR":
      for (let i = 0; i < n; i++) weights[i] = Math.floor(10_000 / n);
      break;
    case "POSITION_BASED": {
      if (n === 1) weights[0] = 10_000;
      else if (n === 2) weights[0] = weights[1] = 5000;
      else {
        weights[0] = 4000;
        weights[n - 1] = 4000;
        const middle = Math.floor(2000 / (n - 2));
        for (let i = 1; i < n - 1; i++) weights[i] = middle;
      }
      break;
    }
    case "TIME_DECAY": {
      const halfLifeMs = 7 * 86400_000;
      const last = touches[n - 1].at.getTime();
      const raw = touches.map((t) => Math.pow(0.5, (last - t.at.getTime()) / halfLifeMs));
      const sum = raw.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) weights[i] = Math.round((raw[i] / sum) * 10_000);
      break;
    }
    default:
      for (let i = 0; i < n; i++) weights[i] = Math.floor(10_000 / n);
  }
  const totalRevenue = touches.filter((t) => t.kind === "CONVERSION").reduce((a, t) => a + t.valueMinor, 0n);
  const creditBps: Record<string, number> = {};
  touches.forEach((t, i) => {
    const key = t.channelCode ?? t.campaignId ?? `touch:${i}`;
    creditBps[key] = (creditBps[key] ?? 0) + weights[i];
  });
  const row = await db.attributionResult.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      subjectKey: data.subjectKey,
      model: data.model as AttributionModelKind,
      creditBps: creditBps as object,
      touchCount: n,
      revenueMinor: totalRevenue,
    },
  });
  return { result: row, touches: touches.length, creditBps, revenueMinor: Number(totalRevenue) };
}

export async function getAttributionResults(ctx: Ctx, query: URLSearchParams) {
  const subjectKey = query.get("subjectKey") ?? undefined;
  const campaignId = query.get("campaignId") ?? undefined;
  return db.attributionResult.findMany({
    where: { orgId: ctx.orgId, ...(subjectKey ? { subjectKey } : {}), ...(campaignId ? { campaignId } : {}) },
    orderBy: { computedAt: "desc" },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Funnels
// ---------------------------------------------------------------------------

export const funnelSchema = z.object({
  name: nameish,
  campaignId: z.string().max(64).nullable().optional(),
  steps: z.array(z.object({ name: nameish, predicate: z.record(z.string(), z.unknown()).default({}) })).min(2).max(20),
});

export async function createFunnel(ctx: Ctx, input: unknown) {
  const data = funnelSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const funnel = await db.$transaction(async (tx) => {
    const f = await tx.funnel.create({
      data: { orgId: ctx.orgId, campaignId: data.campaignId ?? null, name: data.name, createdById: ctx.userId },
    });
    for (let i = 0; i < data.steps.length; i++) {
      await tx.funnelStep.create({ data: { funnelId: f.id, name: data.steps[i].name, position: i, predicate: data.steps[i].predicate as object } });
    }
    await audit(tx, ctx, "funnel.created", "CAMPAIGN", f.id, { steps: data.steps.length });
    return f;
  });
  return funnel;
}

export async function listFunnels(ctx: Ctx) {
  return db.funnel.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    include: { steps: { orderBy: { position: "asc" } }, _count: { select: { snaps: true } } },
  });
}

export async function getFunnel(ctx: Ctx, id: string) {
  const funnel = await requireOwned(
    await db.funnel.findUnique({ where: { id }, include: { steps: { orderBy: { position: "asc" } } } }),
    "Funnel",
    ctx.orgId,
  );
  const latest = await db.funnelSnapshot.findFirst({ where: { funnelId: id }, orderBy: { date: "desc" } });
  return { funnel, latest };
}

/**
 * Snapshot a funnel from recorded OutcomeEvents matching each step's predicate
 * (`kind` and optional `channelCode`). Deterministic counting, no sampling.
 */
export async function snapshotFunnel(ctx: Ctx, id: string) {
  const funnel = await requireOwned(await db.funnel.findUnique({ where: { id }, include: { steps: { orderBy: { position: "asc" } } } }), "Funnel", ctx.orgId);
  const counts: Array<{ step: string; count: number; conversionBps: number }> = [];
  let first: number | null = null;
  for (const step of funnel.steps) {
    const p = step.predicate as { kind?: string; channelCode?: string };
    const count = await db.outcomeEvent.count({
      where: {
        orgId: ctx.orgId,
        ...(funnel.campaignId ? { campaignId: funnel.campaignId } : {}),
        ...(p.kind ? { kind: p.kind as never } : {}),
        ...(p.channelCode ? { channelCode: p.channelCode } : {}),
      },
    });
    if (first === null) first = count;
    counts.push({ step: step.name, count, conversionBps: first && first > 0 ? Math.round((count / first) * 10_000) : 0 });
  }
  const date = new Date(new Date().toISOString().slice(0, 10));
  const snap = await db.funnelSnapshot.upsert({
    where: { funnelId_date: { funnelId: id, date } },
    create: { funnelId: id, orgId: ctx.orgId, date, counts: counts as object },
    update: { counts: counts as object },
  });
  return { snapshot: snap, steps: counts };
}

export async function deleteFunnel(ctx: Ctx, id: string) {
  await requireOwned(await db.funnel.findUnique({ where: { id } }), "Funnel", ctx.orgId);
  await db.funnel.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Conversion prediction
// ---------------------------------------------------------------------------

export const conversionSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  campaignId: z.string().max(64).nullable().optional(),
  features: z.record(z.string(), z.number()).default({}),
});

/** Deterministic logistic-style scoring over supplied numeric features. */
export async function predictConversion(ctx: Ctx, input: unknown) {
  const data = conversionSchema.parse(input);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const f = data.features;
  const z0 = -1.5 + (f.sessions ?? 0) * 0.35 + (f.clicks ?? 0) * 0.4 + (f.emailOpens ?? 0) * 0.15 + (f.pastPurchases ?? 0) * 0.3 - (f.daysSinceActive ?? 0) * 0.02;
  const prob = 1 / (1 + Math.exp(-z0));
  const scoreBps = Math.round(prob * 10_000);
  const row = await db.conversionPrediction.create({
    data: { orgId: ctx.orgId, campaignId: data.campaignId ?? null, subjectKey: data.subjectKey, scoreBps, features: f as object },
  });
  return row;
}

export async function listConversionPredictions(ctx: Ctx, query: URLSearchParams) {
  const campaignId = query.get("campaignId") ?? undefined;
  return db.conversionPrediction.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { scoreBps: "desc" },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Channel optimization
// ---------------------------------------------------------------------------

export const channelOptSchema = z.object({
  campaignId: z.string().max(64).nullable().optional(),
  kind: z.enum(["BUDGET", "CHANNEL", "CREATIVE", "TIMING", "AUDIENCE"]).default("CHANNEL"),
});

/** Reallocate spend toward the channel with the lowest cost per conversion. */
export async function optimizeChannels(ctx: Ctx, input: unknown) {
  const data = channelOptSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const metrics = await db.campaignMetric.groupBy({
    by: ["campaignId"],
    where: { orgId: ctx.orgId, ...(data.campaignId ? { campaignId: data.campaignId } : {}) },
    _sum: { costMinor: true, revenueMinor: true, conversions: true, clicks: true },
  });
  const byChannel = await db.outcomeEvent.groupBy({
    by: ["channelCode"],
    where: { orgId: ctx.orgId, ...(data.campaignId ? { campaignId: data.campaignId } : {}) },
    _sum: { valueMinor: true },
    _count: true,
  });
  const spend = metrics.reduce((a, m) => a + Number(m._sum.costMinor ?? 0n), 0);
  const revenue = metrics.reduce((a, m) => a + Number(m._sum.revenueMinor ?? 0n), 0);
  const conversions = metrics.reduce((a, m) => a + Number(m._sum.conversions ?? 0), 0);
  const cpa = conversions > 0 ? spend / conversions : null;
  const roas = spend > 0 ? revenue / spend : null;
  const ranked = byChannel
    .map((c) => ({ channelCode: c.channelCode, outcomes: c._count, valueMinor: Number(c._sum.valueMinor ?? 0n) }))
    .sort((a, b) => b.valueMinor - a.valueMinor);
  const recommendation = {
    action: "reallocate_spend",
    cpaMinor: cpa,
    roas,
    topChannels: ranked.slice(0, 3),
    suggestedShiftBps: roas && roas > 1.5 ? 2000 : roas && roas > 1 ? 1000 : -1500,
  };
  const row = await db.channelOptimization.create({
    data: { orgId: ctx.orgId, campaignId: data.campaignId ?? null, kind: data.kind as OptimizationKind, recommendation: recommendation as object, expectedUpliftBps: roas && roas > 1 ? 1200 : 0 },
  });
  await audit(db, ctx, "channel_opt.computed", "CAMPAIGN", row.id, { roas });
  return { optimization: row, ranked };
}

export async function listChannelOptimizations(ctx: Ctx, campaignId?: string) {
  return db.channelOptimization.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function applyChannelOptimization(ctx: Ctx, id: string) {
  await requireOwned(await db.channelOptimization.findUnique({ where: { id } }), "Channel optimization", ctx.orgId);
  const row = await db.channelOptimization.update({ where: { id }, data: { applied: true } });
  await audit(db, ctx, "channel_opt.applied", "CAMPAIGN", id);
  return row;
}

// ---------------------------------------------------------------------------
// Autonomous policies
// ---------------------------------------------------------------------------

export const autonomousPolicySchema = z.object({
  campaignId: z.string().max(64).nullable().optional(),
  mode: z.enum(["OFF", "ASSIST", "AUTO"]).default("ASSIST"),
  budgetRule: z.record(z.string(), z.unknown()).default({}),
  actionRule: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertAutonomousPolicy(ctx: Ctx, input: unknown, id?: string) {
  const data = autonomousPolicySchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  if (id) {
    await requireOwned(await db.autonomousPolicy.findUnique({ where: { id } }), "Autonomous policy", ctx.orgId);
    return db.autonomousPolicy.update({
      where: { id },
      data: { mode: data.mode as AutonomousMode, budgetRule: data.budgetRule as object, actionRule: data.actionRule as object },
    });
  }
  return db.autonomousPolicy.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      mode: data.mode as AutonomousMode,
      budgetRule: data.budgetRule as object,
      actionRule: data.actionRule as object,
      createdById: ctx.userId,
    },
  });
}

export async function listAutonomousPolicies(ctx: Ctx) {
  return db.autonomousPolicy.findMany({ where: { orgId: ctx.orgId }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { actions: true } } } });
}

export async function toggleAutonomousPolicy(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.autonomousPolicy.findUnique({ where: { id } }), "Autonomous policy", ctx.orgId);
  return db.autonomousPolicy.update({ where: { id }, data: { active } });
}

/**
 * Propose an action from a policy. ASSIST/AUTO policies produce a proposal;
 * AUTO policies apply immediately, ASSIST waits for approval.
 */
export async function proposeAutonomousAction(ctx: Ctx, policyId: string, kind: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const policy = await requireOwned(await db.autonomousPolicy.findUnique({ where: { id: policyId } }), "Autonomous policy", ctx.orgId);
  if (!policy.active || policy.mode === "OFF") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Policy is not active");
  const auto = policy.mode === "AUTO";
  const action = await db.autonomousAction.create({
    data: { policyId, orgId: ctx.orgId, kind, beforeJson: before as object, afterJson: after as object, applied: auto, approvedById: auto ? ctx.userId : null },
  });
  await emit(db, { type: auto ? "autonomous.applied" : "autonomous.proposed", aggregateType: "CAMPAIGN", aggregateId: policy.campaignId ?? policyId, orgId: ctx.orgId, payload: { kind, actionId: action.id } });
  await audit(db, ctx, auto ? "autonomous.applied" : "autonomous.proposed", "CAMPAIGN", action.id, { kind });
  return action;
}

export async function approveAutonomousAction(ctx: Ctx, id: string) {
  const action = await requireOwned(await db.autonomousAction.findUnique({ where: { id } }), "Autonomous action", ctx.orgId);
  if (action.applied) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Action already applied");
  const row = await db.autonomousAction.update({ where: { id }, data: { applied: true, approvedById: ctx.userId } });
  await emit(db, { type: "autonomous.applied", aggregateType: "CAMPAIGN", aggregateId: action.policyId, orgId: ctx.orgId, payload: { kind: action.kind, actionId: id } });
  await audit(db, ctx, "autonomous.applied", "CAMPAIGN", id, { kind: action.kind });
  return row;
}

export async function listAutonomousActions(ctx: Ctx, policyId?: string) {
  return db.autonomousAction.findMany({
    where: { orgId: ctx.orgId, ...(policyId ? { policyId } : {}) },
    orderBy: { at: "desc" },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Unified intelligence rollup
// ---------------------------------------------------------------------------

export async function intelligenceOverview(ctx: Ctx, campaignId?: string) {
  const [attributions, funnels, conversions, channelOpts, policies, outcomes] = await Promise.all([
    db.attributionResult.count({ where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) } }),
    db.funnel.count({ where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) } }),
    db.conversionPrediction.count({ where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) } }),
    db.channelOptimization.count({ where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) } }),
    db.autonomousPolicy.count({ where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) } }),
    db.outcomeEvent.groupBy({ by: ["kind"], where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) }, _sum: { valueMinor: true }, _count: true }),
  ]);
  return {
    campaignId: campaignId ?? null,
    counts: { attributions, funnels, conversions, channelOptimizations: channelOpts, autonomousPolicies: policies },
    outcomes: outcomes.map((o) => ({ kind: o.kind, count: o._count, valueMinor: Number(o._sum.valueMinor ?? 0n) })),
  };
}

export const ATTRIBUTION_MODELS: AttributionModelKind[] = ["LAST_TOUCH", "FIRST_TOUCH", "LINEAR", "POSITION_BASED", "TIME_DECAY", "CUSTOM"];
export const TOUCH_KIND_LIST = TOUCH_KINDS;
export const INTELLIGENCE_CODE_MAX = 64;
export { bpsSchema as intelligenceBpsSchema, codeish as intelligenceCode };
