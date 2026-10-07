import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, codeish, dateSchema, longText, moneySchema, nameish, paginationSchema, skipTake } from "../schemas";
import { toMinor } from "../money";
import type {
  CampaignLifecycle,
  ExperimentStatus,
  JourneyStatus,
  OptimizationKind,
  OutcomeKind,
} from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Campaign Composition Engine: templates, versioning, journeys, rules,
// decision policies, experiments, optimization runs, budget plans, KPIs and
// outcome events. Owns only its own aggregates; campaign state stays in the
// orchestrator domain and is referenced read-only.
// ===========================================================================

async function requireCampaign(ctx: Ctx, id: string) {
  return requireOwned(await db.campaign.findUnique({ where: { id } }), "Campaign", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Campaign templates
// ---------------------------------------------------------------------------

export const campaignTemplateSchema = z.object({
  code: codeish,
  name: nameish,
  category: z.string().trim().max(40).default("GENERAL"),
  description: z.string().trim().max(2000).nullable().optional(),
  definition: z.record(z.string(), z.unknown()).default({}),
});

export async function createCampaignTemplate(ctx: Ctx, input: unknown) {
  const data = campaignTemplateSchema.parse(input);
  await assertWritable(ctx.orgId);
  const row = await db.campaignTemplate
    .create({
      data: {
        orgId: ctx.orgId,
        code: data.code,
        name: data.name,
        category: data.category,
        description: data.description ?? null,
        definition: data.definition as object,
        createdById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A template with this code already exists");
    });
  await audit(db, ctx, "campaign_template.created", "CAMPAIGN", row.id, { code: row.code });
  return row;
}

export async function listCampaignTemplates(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const where = {
    orgId: ctx.orgId,
    ...(status ? { status: status as never } : {}),
    ...(p.q ? { name: { contains: p.q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.campaignTemplate.findMany({ where, ...skipTake(p), orderBy: { updatedAt: "desc" } }),
    db.campaignTemplate.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getCampaignTemplate(ctx: Ctx, id: string) {
  return requireOwned(await db.campaignTemplate.findUnique({ where: { id } }), "Campaign template", ctx.orgId);
}

export async function publishCampaignTemplate(ctx: Ctx, id: string) {
  const tpl = await requireOwned(await db.campaignTemplate.findUnique({ where: { id } }), "Campaign template", ctx.orgId);
  const row = await db.campaignTemplate.update({
    where: { id },
    data: { status: "PUBLISHED", version: tpl.version + 1, publishedAt: new Date() },
  });
  await audit(db, ctx, "campaign_template.published", "CAMPAIGN", id, { version: row.version });
  return row;
}

export async function deprecateCampaignTemplate(ctx: Ctx, id: string) {
  await requireOwned(await db.campaignTemplate.findUnique({ where: { id } }), "Campaign template", ctx.orgId);
  await db.campaignTemplate.update({ where: { id }, data: { status: "DEPRECATED" } });
  await audit(db, ctx, "campaign_template.deprecated", "CAMPAIGN", id);
}

export async function instantiateCampaignTemplate(ctx: Ctx, id: string, campaignId: string) {
  const tpl = await requireOwned(await db.campaignTemplate.findUnique({ where: { id } }), "Campaign template", ctx.orgId);
  if (tpl.status !== "PUBLISHED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only published templates can be applied");
  const campaign = await requireCampaign(ctx, campaignId);
  const definition = (tpl.definition ?? {}) as Record<string, unknown>;
  await db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { composition: { ...definition, templateId: tpl.id, templateVersion: tpl.version } as object },
    });
    await tx.campaignVersion.create({
      data: { orgId: ctx.orgId, campaignId, version: 1, snapshot: { ...definition, lifecycle: campaign.lifecycle } as object, changeNote: `Applied template ${tpl.code} v${tpl.version}`, createdById: ctx.userId },
    });
    await emit(tx, { type: "campaign.template_applied", aggregateType: "CAMPAIGN", aggregateId: campaignId, orgId: ctx.orgId, payload: { templateId: tpl.id, code: tpl.code } });
    await audit(tx, ctx, "campaign.template_applied", "CAMPAIGN", campaignId, { templateId: tpl.id });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export async function snapshotCampaignVersion(ctx: Ctx, campaignId: string, changeNote: string | null, snapshot: Record<string, unknown>) {
  const campaign = await requireCampaign(ctx, campaignId);
  const last = await db.campaignVersion.findFirst({ where: { campaignId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const row = await db.campaignVersion.create({
    data: { orgId: ctx.orgId, campaignId, version, snapshot: (snapshot ?? { composition: campaign.composition }) as object, changeNote: changeNote ?? null, createdById: ctx.userId },
  });
  await audit(db, ctx, "campaign.versioned", "CAMPAIGN", campaignId, { version });
  return row;
}

export async function listCampaignVersions(ctx: Ctx, campaignId: string) {
  await requireCampaign(ctx, campaignId);
  return db.campaignVersion.findMany({ where: { campaignId, orgId: ctx.orgId }, orderBy: { version: "desc" } });
}

export async function diffCampaignVersions(ctx: Ctx, campaignId: string, fromVersion: number, toVersion: number) {
  await requireCampaign(ctx, campaignId);
  const [from, to] = await Promise.all([
    db.campaignVersion.findUnique({ where: { campaignId_version: { campaignId, version: fromVersion } } }),
    db.campaignVersion.findUnique({ where: { campaignId_version: { campaignId, version: toVersion } } }),
  ]);
  if (!from || !to) throw new AppError(ErrorCodes.NOT_FOUND, "Version not found");
  const a = (from.snapshot ?? {}) as Record<string, unknown>;
  const b = (to.snapshot ?? {}) as Record<string, unknown>;
  const changed = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
  return { fromVersion, toVersion, changed, before: a, after: b };
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

export const journeySchema = z.object({
  name: nameish,
  description: z.string().trim().max(2000).nullable().optional(),
  campaignId: z.string().max(64).nullable().optional(),
  triggerEvent: z.string().trim().max(80).default("campaign.launched"),
  definition: z.record(z.string(), z.unknown()).default({}),
});

export async function createJourney(ctx: Ctx, input: unknown) {
  const data = journeySchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const row = await db.journey.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      name: data.name,
      description: data.description ?? null,
      triggerEvent: data.triggerEvent,
      definition: data.definition as object,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "journey.created", "CAMPAIGN", row.id, { name: row.name });
  return row;
}

export async function listJourneys(ctx: Ctx) {
  return db.journey.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { nodes: true, runs: true } }, campaign: { select: { id: true, name: true } } },
  });
}

export async function getJourney(ctx: Ctx, id: string) {
  const j = await requireOwned(
    await db.journey.findUnique({ where: { id }, include: { nodes: { orderBy: { position: "asc" } }, campaign: { select: { id: true, name: true } } } }),
    "Journey",
    ctx.orgId,
  );
  const runs = await db.journeyRun.groupBy({ by: ["status"], where: { journeyId: id, orgId: ctx.orgId }, _count: true });
  return { journey: j, runBreakdown: Object.fromEntries(runs.map((r) => [r.status, r._count])) };
}

const NODE_KINDS = ["TRIGGER", "DELAY", "CONDITION", "SPLIT", "MESSAGE", "ACTION", "EXIT"] as const;

export const journeyNodeSchema = z.object({
  kind: z.enum(NODE_KINDS),
  position: z.number().int().min(0).default(0),
  label: z.string().trim().max(120).nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  nextIds: z.array(z.string().max(64)).max(20).default([]),
});

export async function addJourneyNode(ctx: Ctx, journeyId: string, input: unknown) {
  const data = journeyNodeSchema.parse(input);
  const journey = await requireOwned(await db.journey.findUnique({ where: { id: journeyId } }), "Journey", ctx.orgId);
  if (journey.status !== "DRAFT") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only draft journeys can be edited");
  return db.journeyNode.create({
    data: { journeyId, kind: data.kind, position: data.position, label: data.label ?? null, config: data.config as object, nextIds: data.nextIds },
  });
}

export async function updateJourneyStatus(ctx: Ctx, id: string, to: JourneyStatus) {
  const journey = await requireOwned(await db.journey.findUnique({ where: { id }, include: { nodes: true } }), "Journey", ctx.orgId);
  const allowed: Record<string, JourneyStatus[]> = {
    DRAFT: ["ACTIVE", "ARCHIVED"],
    ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
    PAUSED: ["ACTIVE", "ARCHIVED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  if (!allowed[journey.status].includes(to)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Journey cannot go ${journey.status.toLowerCase()} → ${to.toLowerCase()}`);
  }
  if (to === "ACTIVE" && journey.nodes.length === 0) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "A journey needs at least one node before activation");
  }
  const row = await db.journey.update({ where: { id }, data: { status: to } });
  await audit(db, ctx, `journey.${to.toLowerCase()}`, "CAMPAIGN", id);
  return row;
}

export async function startJourneyRun(ctx: Ctx, journeyId: string, subjectKey: string, context: Record<string, unknown> = {}) {
  const journey = await requireOwned(await db.journey.findUnique({ where: { id: journeyId }, include: { nodes: { orderBy: { position: "asc" } } } }), "Journey", ctx.orgId);
  if (journey.status !== "ACTIVE") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Journey is not active");
  const first = journey.nodes[0];
  return db.journeyRun.create({
    data: { journeyId, orgId: ctx.orgId, subjectKey, currentNodeId: first?.id ?? null, status: "RUNNING", context: context as object },
  });
}

/** Deterministic single-step advance: DELAY/WAITING nodes park the run. */
export async function advanceJourneyRun(ctx: Ctx, runId: string) {
  const run = await requireOwned(await db.journeyRun.findUnique({ where: { id: runId } }), "Journey run", ctx.orgId);
  if (run.status !== "RUNNING" && run.status !== "WAITING") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Run is not active");
  if (!run.currentNodeId) {
    const done = await db.journeyRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date() } });
    return done;
  }
  const node = await db.journeyNode.findUnique({ where: { id: run.currentNodeId } });
  if (!node) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Current node no longer exists");
  if (node.kind === "EXIT") {
    return db.journeyRun.update({ where: { id: runId }, data: { status: "EXITED", finishedAt: new Date() } });
  }
  if (node.kind === "DELAY") {
    const seconds = Number((node.config as { seconds?: number }).seconds ?? 0);
    const until = new Date(Date.now() + Math.max(0, seconds) * 1000);
    return db.journeyRun.update({ where: { id: runId }, data: { status: "WAITING", context: { ...(run.context as object), resumeAt: until.toISOString() } as object } });
  }
  const next = node.nextIds[0] ?? null;
  const updated = await db.journeyRun.update({
    where: { id: runId },
    data: { currentNodeId: next, status: next ? "RUNNING" : "COMPLETED", ...(next ? {} : { finishedAt: new Date() }) },
  });
  await emit(db, { type: "journey.run_advanced", aggregateType: "CAMPAIGN", aggregateId: run.journeyId, orgId: ctx.orgId, payload: { runId, nodeId: node.id, kind: node.kind } });
  return updated;
}

// ---------------------------------------------------------------------------
// Rules & decision policies
// ---------------------------------------------------------------------------

export const ruleSchema = z.object({
  code: codeish,
  name: nameish,
  appliesTo: z.string().trim().max(40).default("CAMPAIGN"),
  predicate: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(10_000).default(100),
});

export async function upsertRule(ctx: Ctx, input: unknown, id?: string) {
  const data = ruleSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (id) {
    await requireOwned(await db.ruleDefinition.findUnique({ where: { id } }), "Rule", ctx.orgId);
    return db.ruleDefinition.update({ where: { id }, data: { name: data.name, appliesTo: data.appliesTo, predicate: data.predicate as object, priority: data.priority } });
  }
  return db.ruleDefinition
    .create({ data: { orgId: ctx.orgId, code: data.code, name: data.name, appliesTo: data.appliesTo, predicate: data.predicate as object, priority: data.priority, createdById: ctx.userId } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A rule with this code already exists");
    });
}

export async function listRules(ctx: Ctx) {
  return db.ruleDefinition.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ appliesTo: "asc" }, { priority: "asc" }] });
}

export async function toggleRule(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.ruleDefinition.findUnique({ where: { id } }), "Rule", ctx.orgId);
  return db.ruleDefinition.update({ where: { id }, data: { active } });
}

export async function deleteRule(ctx: Ctx, id: string) {
  await requireOwned(await db.ruleDefinition.findUnique({ where: { id } }), "Rule", ctx.orgId);
  await db.ruleDefinition.delete({ where: { id } });
}

export const decisionPolicySchema = z.object({
  code: codeish,
  name: nameish,
  inputs: z.array(z.string().max(60)).max(40).default([]),
  outcome: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(10_000).default(100),
});

export async function upsertDecisionPolicy(ctx: Ctx, input: unknown, id?: string) {
  const data = decisionPolicySchema.parse(input);
  await assertWritable(ctx.orgId);
  if (id) {
    await requireOwned(await db.decisionPolicy.findUnique({ where: { id } }), "Decision policy", ctx.orgId);
    return db.decisionPolicy.update({ where: { id }, data: { name: data.name, inputs: data.inputs, outcome: data.outcome as object, priority: data.priority } });
  }
  return db.decisionPolicy
    .create({ data: { orgId: ctx.orgId, code: data.code, name: data.name, inputs: data.inputs, outcome: data.outcome as object, priority: data.priority, createdById: ctx.userId } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A decision policy with this code already exists");
    });
}

export async function listDecisionPolicies(ctx: Ctx) {
  return db.decisionPolicy.findMany({ where: { orgId: ctx.orgId }, orderBy: { priority: "asc" } });
}

/** Evaluate ordered decision policies against a facts bag; first match wins. */
export async function evaluateDecision(ctx: Ctx, facts: Record<string, unknown>) {
  const policies = await db.decisionPolicy.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { priority: "asc" } });
  for (const p of policies) {
    const outcome = (p.outcome ?? {}) as Record<string, unknown>;
    const match = Object.entries(outcome).every(([k, v]) => facts[k] === v);
    if (match) {
      await audit(db, ctx, "decision.evaluated", "CAMPAIGN", p.id, { code: p.code });
      return { policy: { id: p.id, code: p.code, name: p.name }, outcome };
    }
  }
  return { policy: null, outcome: null };
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const experimentSchema = z.object({
  code: codeish,
  name: nameish,
  hypothesis: z.string().trim().max(2000).nullable().optional(),
  campaignId: z.string().max(64).nullable().optional(),
  variants: z.array(z.object({ key: z.string().trim().max(40), weight: bpsSchema.default(5000) })).min(2).max(10),
  metric: z.string().trim().max(40).default("conversion"),
});

export async function createExperiment(ctx: Ctx, input: unknown) {
  const data = experimentSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const weight = data.variants.reduce((a, v) => a + v.weight, 0);
  if (weight !== 10_000) throw new AppError(ErrorCodes.VALIDATION, "Variant weights must sum to 10000 bps");
  return db.experiment
    .create({
      data: {
        orgId: ctx.orgId,
        campaignId: data.campaignId ?? null,
        code: data.code,
        name: data.name,
        hypothesis: data.hypothesis ?? null,
        variants: data.variants as object,
        metric: data.metric,
        createdById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "An experiment with this code already exists");
    });
}

export async function listExperiments(ctx: Ctx) {
  return db.experiment.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { assignments: true } } },
  });
}

export async function getExperiment(ctx: Ctx, id: string) {
  const exp = await requireOwned(await db.experiment.findUnique({ where: { id } }), "Experiment", ctx.orgId);
  const byVariant = await db.experimentAssignment.groupBy({
    by: ["variant"],
    where: { experimentId: id, orgId: ctx.orgId },
    _count: true,
  });
  const converted = await db.experimentAssignment.groupBy({
    by: ["variant"],
    where: { experimentId: id, orgId: ctx.orgId, converted: true },
    _count: true,
  });
  const convertedMap = new Map(converted.map((c) => [c.variant, c._count]));
  return {
    experiment: exp,
    variants: byVariant.map((v) => ({
      variant: v.variant,
      assigned: v._count,
      converted: convertedMap.get(v.variant) ?? 0,
      rateBps: v._count > 0 ? Math.round(((convertedMap.get(v.variant) ?? 0) / v._count) * 10_000) : 0,
    })),
  };
}

export async function transitionExperiment(ctx: Ctx, id: string, to: ExperimentStatus) {
  const exp = await requireOwned(await db.experiment.findUnique({ where: { id } }), "Experiment", ctx.orgId);
  const allowed: Record<string, ExperimentStatus[]> = {
    DRAFT: ["RUNNING", "ARCHIVED"],
    RUNNING: ["PAUSED", "CONCLUDED", "ARCHIVED"],
    PAUSED: ["RUNNING", "CONCLUDED", "ARCHIVED"],
    CONCLUDED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  if (!allowed[exp.status].includes(to)) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Experiment cannot go ${exp.status.toLowerCase()} → ${to.toLowerCase()}`);
  const row = await db.experiment.update({
    where: { id },
    data: { status: to, ...(to === "RUNNING" ? { startsAt: exp.startsAt ?? new Date() } : {}), ...(to === "CONCLUDED" ? { endsAt: new Date() } : {}) },
  });
  await audit(db, ctx, `experiment.${to.toLowerCase()}`, "CAMPAIGN", id);
  return row;
}

/** Deterministic weighted bucketing on a stable subject hash. */
export async function assignVariant(ctx: Ctx, experimentId: string, subjectKey: string) {
  const exp = await requireOwned(await db.experiment.findUnique({ where: { id: experimentId } }), "Experiment", ctx.orgId);
  if (exp.status !== "RUNNING") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Experiment is not running");
  const existing = await db.experimentAssignment.findUnique({ where: { experimentId_subjectKey: { experimentId, subjectKey } } });
  if (existing) return existing;
  const variants = exp.variants as Array<{ key: string; weight: number }>;
  const bucket = stableBucket(`${exp.id}:${subjectKey}`);
  let acc = 0;
  let chosen = variants[variants.length - 1].key;
  for (const v of variants) {
    acc += v.weight;
    if (bucket < acc) {
      chosen = v.key;
      break;
    }
  }
  return db.experimentAssignment.create({ data: { experimentId, orgId: ctx.orgId, subjectKey, variant: chosen } });
}

export async function recordExperimentConversion(ctx: Ctx, experimentId: string, subjectKey: string, meta: Record<string, unknown> = {}) {
  const a = await db.experimentAssignment.findUnique({ where: { experimentId_subjectKey: { experimentId, subjectKey } } });
  if (!a || a.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Assignment not found");
  const row = await db.experimentAssignment.update({ where: { id: a.id }, data: { converted: true, convertedAt: new Date(), meta: { ...(a.meta as object), ...meta } as object } });
  await emit(db, { type: "experiment.converted", aggregateType: "CAMPAIGN", aggregateId: experimentId, orgId: ctx.orgId, payload: { variant: row.variant } });
  return row;
}

/** Conclude with a two-proportion z-approximation; winner only when significant. */
export async function concludeExperiment(ctx: Ctx, id: string) {
  const { experiment, variants } = await getExperiment(ctx, id);
  if (experiment.status !== "RUNNING" && experiment.status !== "PAUSED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Experiment is not running");
  const ranked = [...variants].sort((a, b) => b.rateBps - a.rateBps);
  const top = ranked[0];
  const runnerUp = ranked[1];
  let winner: string | null = null;
  let significant = false;
  if (top && runnerUp) {
    const p1 = top.converted / Math.max(1, top.assigned);
    const p2 = runnerUp.converted / Math.max(1, runnerUp.assigned);
    const pooled = (top.converted + runnerUp.converted) / Math.max(1, top.assigned + runnerUp.assigned);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, top.assigned) + 1 / Math.max(1, runnerUp.assigned)));
    const z = se > 0 ? (p1 - p2) / se : 0;
    significant = Math.abs(z) >= 1.96;
    winner = significant ? top.variant : null;
  }
  const row = await db.experiment.update({ where: { id }, data: { status: "CONCLUDED", endsAt: new Date(), winnerVariant: winner } });
  await audit(db, ctx, "experiment.concluded", "CAMPAIGN", id, { winner, significant });
  return { experiment: row, ranked, significant, winner };
}

// ---------------------------------------------------------------------------
// Optimization runs
// ---------------------------------------------------------------------------

export const optimizationSchema = z.object({
  kind: z.enum(["BUDGET", "CHANNEL", "CREATIVE", "TIMING", "AUDIENCE"]),
  campaignId: z.string().max(64).nullable().optional(),
});

/** Deterministic recommender over recorded metrics — no external calls. */
export async function runOptimization(ctx: Ctx, input: unknown) {
  const data = optimizationSchema.parse(input);
  await assertWritable(ctx.orgId);
  let recommendation: Record<string, unknown> = {};
  let upliftBps = 0;
  if (data.campaignId) {
    await requireCampaign(ctx, data.campaignId);
    const metrics = await db.campaignMetric.findMany({ where: { campaignId: data.campaignId } });
    const revenue = metrics.reduce((a, m) => a + Number(m.revenueMinor ?? 0n), 0);
    const cost = metrics.reduce((a, m) => a + Number(m.costMinor ?? 0n), 0);
    const roas = cost > 0 ? revenue / cost : 0;
    if (data.kind === "BUDGET") {
      const shiftBps = roas > 2 ? 1500 : roas > 1 ? 500 : -1000;
      recommendation = { action: "shift_budget", shiftBps, rationale: `ROAS ${roas.toFixed(2)} across ${metrics.length} days` };
      upliftBps = Math.max(0, Math.abs(shiftBps) - 500);
    } else if (data.kind === "CHANNEL") {
      recommendation = { action: "reallocate_channels", rationale: "Concentrate spend on lowest CPA channel", roas };
      upliftBps = roas > 1 ? 800 : 0;
    } else {
      recommendation = { action: "test_variants", rationale: "Run an A/B test on creative/timing", sampleDays: metrics.length };
      upliftBps = 300;
    }
  } else {
    recommendation = { action: "no_campaign_context", rationale: "Attach a campaign for targeted recommendations" };
  }
  const row = await db.optimizationRun.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      kind: data.kind as OptimizationKind,
      input: data as object,
      recommendation: recommendation as object,
      expectedUpliftBps: upliftBps,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "optimization.run", "CAMPAIGN", row.id, { kind: data.kind });
  return row;
}

export async function listOptimizations(ctx: Ctx, campaignId?: string) {
  return db.optimizationRun.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function applyOptimization(ctx: Ctx, id: string) {
  const row = await requireOwned(await db.optimizationRun.findUnique({ where: { id } }), "Optimization run", ctx.orgId);
  const updated = await db.optimizationRun.update({ where: { id }, data: { applied: true } });
  await audit(db, ctx, "optimization.applied", "CAMPAIGN", id, { kind: row.kind });
  return updated;
}

// ---------------------------------------------------------------------------
// Budget plans
// ---------------------------------------------------------------------------

export const budgetSchema = z.object({
  campaignId: z.string().min(1),
  mode: z.enum(["FIXED", "PACING", "AUTO"]).default("FIXED"),
  total: moneySchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
  allocations: z.array(z.object({ channelId: z.string().max(64), weightBps: bpsSchema })).max(24).default([]),
  pacing: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertBudgetPlan(ctx: Ctx, input: unknown) {
  const data = budgetSchema.parse(input);
  await assertWritable(ctx.orgId);
  await requireCampaign(ctx, data.campaignId);
  if (data.allocations.length && data.allocations.reduce((a, x) => a + x.weightBps, 0) !== 10_000) {
    throw new AppError(ErrorCodes.VALIDATION, "Budget allocations must sum to 10000 bps");
  }
  const totalMinor = toMinor(data.total);
  const row = await db.budgetPlan.upsert({
    where: { campaignId: data.campaignId },
    create: { orgId: ctx.orgId, campaignId: data.campaignId, mode: data.mode, totalMinor, currencyCode: data.currencyCode, allocations: data.allocations as object, pacingJson: data.pacing as object, createdById: ctx.userId },
    update: { mode: data.mode, totalMinor, currencyCode: data.currencyCode, allocations: data.allocations as object, pacingJson: data.pacing as object },
  });
  await audit(db, ctx, "budget.upserted", "CAMPAIGN", data.campaignId, { mode: data.mode });
  return row;
}

export async function getBudgetPlan(ctx: Ctx, campaignId: string) {
  await requireCampaign(ctx, campaignId);
  return db.budgetPlan.findUnique({ where: { campaignId } });
}

/** Deterministic pacing: linear daily burn vs elapsed window. */
export async function paceBudget(ctx: Ctx, campaignId: string) {
  const campaign = await requireCampaign(ctx, campaignId);
  const plan = await db.budgetPlan.findUnique({ where: { campaignId } });
  if (!plan) throw new AppError(ErrorCodes.NOT_FOUND, "No budget plan for this campaign");
  const start = campaign.startDate?.getTime() ?? Date.now();
  const end = campaign.endDate?.getTime() ?? start + 86400_000;
  const total = Number(plan.totalMinor);
  const days = Math.max(1, Math.round((end - start) / 86400_000));
  const elapsed = Math.min(days, Math.max(0, Math.round((Date.now() - start) / 86400_000)));
  const expectedMinor = Math.round((total * elapsed) / days);
  const spent = await db.campaignMetric.aggregate({ where: { campaignId }, _sum: { costMinor: true } });
  const spentMinor = Number(spent._sum.costMinor ?? 0n);
  return {
    campaignId,
    mode: plan.mode,
    totalMinor: total,
    days,
    elapsedDays: elapsed,
    expectedSpendMinor: expectedMinor,
    actualSpendMinor: spentMinor,
    deltaMinor: spentMinor - expectedMinor,
    status: spentMinor > expectedMinor * 1.1 ? "OVER_PACE" : spentMinor < expectedMinor * 0.9 ? "UNDER_PACE" : "ON_PACE",
  };
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export const kpiSchema = z.object({
  code: codeish,
  name: nameish,
  module: z.enum(["CAMPAIGN", "CHANNEL", "AUDIENCE", "CONTENT", "OFFER", "OPERATIONS"]).default("CAMPAIGN"),
  unit: z.enum(["CURRENCY", "COUNT", "RATIO", "BPS"]).default("COUNT"),
  targetValue: z.number().int().default(0),
  thresholdValue: z.number().int().default(0),
  direction: z.enum(["UP", "DOWN"]).default("UP"),
});

export async function upsertKpi(ctx: Ctx, input: unknown, id?: string) {
  const data = kpiSchema.parse(input);
  await assertWritable(ctx.orgId);
  const payload = {
    name: data.name,
    module: data.module as never,
    unit: data.unit as never,
    targetValue: BigInt(data.targetValue),
    thresholdValue: BigInt(data.thresholdValue),
    direction: data.direction,
  };
  if (id) {
    await requireOwned(await db.kpiDef.findUnique({ where: { id } }), "KPI", ctx.orgId);
    return db.kpiDef.update({ where: { id }, data: payload });
  }
  return db.kpiDef
    .create({ data: { orgId: ctx.orgId, code: data.code, ...payload, createdById: ctx.userId } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A KPI with this code already exists");
    });
}

export async function listKpis(ctx: Ctx) {
  const rows = await db.kpiDef.findMany({ where: { orgId: ctx.orgId }, orderBy: { code: "asc" } });
  return rows.map((r) => ({ ...r, targetValue: Number(r.targetValue), thresholdValue: Number(r.thresholdValue) }));
}

export const kpiSnapshotSchema = z.object({
  date: dateSchema,
  value: z.number().int(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function recordKpiSnapshot(ctx: Ctx, kpiId: string, input: unknown) {
  const data = kpiSnapshotSchema.parse(input);
  await requireOwned(await db.kpiDef.findUnique({ where: { id: kpiId } }), "KPI", ctx.orgId);
  const date = new Date(data.date);
  return db.kpiSnapshot.upsert({
    where: { kpiId_date: { kpiId, date } },
    create: { kpiId, orgId: ctx.orgId, date, value: BigInt(data.value), meta: data.meta as object },
    update: { value: BigInt(data.value), meta: data.meta as object },
  });
}

export async function evaluateKpis(ctx: Ctx) {
  const kpis = await db.kpiDef.findMany({ where: { orgId: ctx.orgId, active: true } });
  const out = [];
  for (const k of kpis) {
    const latest = await db.kpiSnapshot.findFirst({ where: { kpiId: k.id }, orderBy: { date: "desc" } });
    const value = Number(latest?.value ?? 0n);
    const target = Number(k.targetValue);
    const threshold = Number(k.thresholdValue);
    const healthy = k.direction === "UP" ? value >= target : value <= target;
    const breach = k.direction === "UP" ? value < threshold : value > threshold;
    out.push({ code: k.code, name: k.name, unit: k.unit, value, target, threshold, status: healthy ? "ON_TARGET" : breach ? "BREACH" : "AT_RISK" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outcome events
// ---------------------------------------------------------------------------

export const outcomeSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(["IMPRESSION", "CLICK", "CONVERSION", "REVENUE", "REDEMPTION", "SIGNUP", "SUBSCRIPTION", "CHURN", "CUSTOM"]).default("CONVERSION"),
  campaignId: z.string().max(64).nullable().optional(),
  channelCode: z.string().trim().max(40).nullable().optional(),
  value: moneySchema.default(0),
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function recordOutcome(ctx: Ctx, input: unknown) {
  const data = outcomeSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireCampaign(ctx, data.campaignId);
  const row = await db.outcomeEvent.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId ?? null,
      subjectKey: data.subjectKey,
      kind: data.kind as OutcomeKind,
      channelCode: data.channelCode ?? null,
      valueMinor: toMinor(data.value),
      currencyCode: data.currencyCode,
      meta: data.meta as object,
    },
  });
  await emit(db, { type: "outcome.recorded", aggregateType: "CAMPAIGN", aggregateId: data.campaignId ?? row.id, orgId: ctx.orgId, payload: { kind: data.kind, valueMinor: Number(row.valueMinor) } });
  return row;
}

export async function listOutcomes(ctx: Ctx, query: URLSearchParams) {
  const campaignId = query.get("campaignId") ?? undefined;
  const kind = query.get("kind") ?? undefined;
  return db.outcomeEvent.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}), ...(kind ? { kind: kind as never } : {}) },
    orderBy: { at: "desc" },
    take: 200,
  });
}

export async function rollupOutcomes(ctx: Ctx, campaignId: string) {
  await requireCampaign(ctx, campaignId);
  const byKind = await db.outcomeEvent.groupBy({ by: ["kind"], where: { campaignId, orgId: ctx.orgId }, _sum: { valueMinor: true }, _count: true });
  const byChannel = await db.outcomeEvent.groupBy({ by: ["channelCode"], where: { campaignId, orgId: ctx.orgId }, _sum: { valueMinor: true }, _count: true });
  return {
    campaignId,
    byKind: byKind.map((k) => ({ kind: k.kind, count: k._count, valueMinor: Number(k._sum.valueMinor ?? 0n) })),
    byChannel: byChannel.map((c) => ({ channelCode: c.channelCode, count: c._count, valueMinor: Number(c._sum.valueMinor ?? 0n) })),
  };
}

export async function recordCampaignVersion(ctx: Ctx, campaignId: string, snapshot: Record<string, unknown>, changeNote?: string) {
  return snapshotCampaignVersion(ctx, campaignId, changeNote ?? null, snapshot);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableBucket(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 10_000;
}

export const LIFECYCLE_TRANSITIONS: Record<CampaignLifecycle, CampaignLifecycle[]> = {
  DRAFT: ["PLANNED", "PENDING_APPROVAL"],
  PLANNED: ["PENDING_APPROVAL", "DRAFT"],
  PENDING_APPROVAL: ["APPROVED", "PLANNED"],
  APPROVED: ["LIVE", "PLANNED"],
  LIVE: ["CLOSED"],
  CLOSED: ["LEARNED"],
  LEARNED: [],
};
