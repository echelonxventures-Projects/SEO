import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { codeish, longText, nameish, paginationSchema, skipTake } from "../schemas";
import type {
  ComplianceCheckStatus,
  ComplianceFramework,
  DigitalTwinSubject,
  KnowledgeKind,
} from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Foundation Platforms: knowledge base, universal search index, digital
// twins and compliance policies. All deterministic; no external calls.
// ===========================================================================

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

const KNOWLEDGE_KINDS = ["FAQ", "PLAYBOOK", "ARTICLE", "POLICY", "RUNBOOK", "TEMPLATE"] as const;

export const knowledgeSchema = z.object({
  kind: z.enum(KNOWLEDGE_KINDS).default("ARTICLE"),
  title: nameish,
  body: longText,
  tags: z.array(z.string().trim().max(40)).max(25).default([]),
  sourceRef: z.string().trim().max(300).nullable().optional(),
});

export async function createKnowledgeItem(ctx: Ctx, input: unknown) {
  const data = knowledgeSchema.parse(input);
  await assertWritable(ctx.orgId);
  const row = await db.knowledgeItem.create({
    data: { orgId: ctx.orgId, kind: data.kind as KnowledgeKind, title: data.title, body: data.body, tags: data.tags, sourceRef: data.sourceRef ?? null, createdById: ctx.userId },
  });
  await audit(db, ctx, "knowledge.created", undefined, row.id, { kind: data.kind });
  return row;
}

export async function listKnowledge(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const kind = query.get("kind") ?? undefined;
  const tag = query.get("tag") ?? undefined;
  const where = {
    orgId: ctx.orgId,
    ...(kind ? { kind: kind as KnowledgeKind } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(p.q ? { OR: [{ title: { contains: p.q, mode: "insensitive" as const } }, { body: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.knowledgeItem.findMany({ where, ...skipTake(p), orderBy: { updatedAt: "desc" } }),
    db.knowledgeItem.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function getKnowledgeItem(ctx: Ctx, id: string) {
  return requireOwned(await db.knowledgeItem.findUnique({ where: { id } }), "Knowledge item", ctx.orgId);
}

export async function deleteKnowledgeItem(ctx: Ctx, id: string) {
  await requireOwned(await db.knowledgeItem.findUnique({ where: { id } }), "Knowledge item", ctx.orgId);
  await db.knowledgeItem.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Universal search index
// ---------------------------------------------------------------------------

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2 && t.length <= 40),
    ),
  ).slice(0, 200);
}

export const indexRowSchema = z.object({
  entityType: z.string().trim().min(1).max(40),
  entityId: z.string().trim().min(1).max(64),
  title: nameish,
  body: longText,
});

export async function indexEntity(ctx: Ctx, input: unknown) {
  const data = indexRowSchema.parse(input);
  const tokens = tokenize(`${data.title} ${data.body}`);
  const row = await db.searchIndexRow.upsert({
    where: { orgId_entityType_entityId: { orgId: ctx.orgId, entityType: data.entityType, entityId: data.entityId } },
    create: { orgId: ctx.orgId, entityType: data.entityType, entityId: data.entityId, title: data.title, body: data.body, tokens },
    update: { title: data.title, body: data.body, tokens },
  });
  return row;
}

export async function removeFromIndex(ctx: Ctx, entityType: string, entityId: string) {
  await db.searchIndexRow.deleteMany({ where: { orgId: ctx.orgId, entityType, entityId } });
}

export async function universalSearch(ctx: Ctx, query: URLSearchParams) {
  const q = (query.get("q") ?? "").trim();
  const entityType = query.get("entityType") ?? undefined;
  const limit = Math.min(100, Number(query.get("limit") ?? 25));
  if (q.length < 2) return { rows: [], total: 0 };
  const tokens = tokenize(q);
  const rows = await db.searchIndexRow.findMany({
    where: {
      orgId: ctx.orgId,
      ...(entityType ? { entityType } : {}),
      OR: [{ tokens: { hasSome: tokens } }, { title: { contains: q, mode: "insensitive" as const } }],
    },
    take: 500,
  });
  const scored = rows
    .map((r) => {
      const titleHits = tokens.filter((t) => r.title.toLowerCase().includes(t)).length;
      const tokenHits = tokens.filter((t) => r.tokens.includes(t)).length;
      return { r, score: titleHits * 3 + tokenHits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r, score }) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, title: r.title, score }));
  return { rows: scored, total: scored.length };
}

/** Rebuild the index for a slice of core entities (posts, blogs, knowledge, offers). */
export async function rebuildSearchIndex(ctx: Ctx, limit = 500) {
  const [posts, blogs, knowledge, offers] = await Promise.all([
    db.contentPost.findMany({ where: { orgId: ctx.orgId }, take: limit, select: { id: true, title: true, body: true } }),
    db.blogPost.findMany({ where: { orgId: ctx.orgId }, take: limit, select: { id: true, title: true, bodyMarkdown: true } }),
    db.knowledgeItem.findMany({ where: { orgId: ctx.orgId }, take: limit, select: { id: true, title: true, body: true } }),
    db.offer.findMany({ where: { orgId: ctx.orgId }, take: limit, select: { id: true, name: true, description: true } }),
  ]);
  let indexed = 0;
  for (const p of posts) {
    await indexEntity(ctx, { entityType: "CONTENT_POST", entityId: p.id, title: p.title, body: p.body });
    indexed++;
  }
  for (const b of blogs) {
    await indexEntity(ctx, { entityType: "BLOG_POST", entityId: b.id, title: b.title, body: b.bodyMarkdown });
    indexed++;
  }
  for (const k of knowledge) {
    await indexEntity(ctx, { entityType: "KNOWLEDGE", entityId: k.id, title: k.title, body: k.body });
    indexed++;
  }
  for (const o of offers) {
    await indexEntity(ctx, { entityType: "OFFER", entityId: o.id, title: o.name, body: o.description ?? "" });
    indexed++;
  }
  await audit(db, ctx, "search.reindexed", undefined, undefined, { indexed });
  return { indexed };
}

// ---------------------------------------------------------------------------
// Digital twin
// ---------------------------------------------------------------------------

const TWIN_SUBJECTS = ["CLIENT", "CAMPAIGN", "AUDIENCE", "CHANNEL", "OFFER"] as const;

export const twinSchema = z.object({
  subjectType: z.enum(TWIN_SUBJECTS),
  subjectId: z.string().trim().min(1).max(64),
  state: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertDigitalTwin(ctx: Ctx, input: unknown) {
  const data = twinSchema.parse(input);
  await assertWritable(ctx.orgId);
  const existing = await db.digitalTwinModel.findUnique({
    where: { orgId_subjectType_subjectId: { orgId: ctx.orgId, subjectType: data.subjectType as DigitalTwinSubject, subjectId: data.subjectId } },
  });
  const row = await db.digitalTwinModel.upsert({
    where: { orgId_subjectType_subjectId: { orgId: ctx.orgId, subjectType: data.subjectType as DigitalTwinSubject, subjectId: data.subjectId } },
    create: { orgId: ctx.orgId, subjectType: data.subjectType as DigitalTwinSubject, subjectId: data.subjectId, state: data.state as object, version: 1 },
    update: { state: data.state as object, version: (existing?.version ?? 0) + 1 },
  });
  await audit(db, ctx, "digital_twin.upserted", undefined, row.id, { subjectType: data.subjectType });
  return row;
}

export async function listDigitalTwins(ctx: Ctx, subjectType?: DigitalTwinSubject) {
  return db.digitalTwinModel.findMany({ where: { orgId: ctx.orgId, ...(subjectType ? { subjectType } : {}) }, orderBy: { updatedAt: "desc" } });
}

/** Synthesize a twin from live aggregates; state is a deterministic snapshot. */
export async function synthesizeClientTwin(ctx: Ctx, clientId: string) {
  const client = await requireOwned(await db.client.findUnique({ where: { id: clientId } }), "Client", ctx.orgId);
  const [campaigns, invoices, contracts] = await Promise.all([
    db.campaign.findMany({ where: { orgId: ctx.orgId, clientId }, select: { id: true, lifecycle: true } }),
    db.invoice.aggregate({ where: { orgId: ctx.orgId, clientId }, _sum: { totalMinor: true, paidMinor: true }, _count: true }),
    db.contract.count({ where: { orgId: ctx.orgId, clientId, status: "ACTIVE" } }),
  ]);
  const state = {
    clientId,
    status: client.status,
    activeCampaigns: campaigns.filter((c) => c.lifecycle === "LIVE").length,
    totalCampaigns: campaigns.length,
    billedMinor: Number(invoices._sum.totalMinor ?? 0n),
    paidMinor: Number(invoices._sum.paidMinor ?? 0n),
    activeContracts: contracts,
    healthScore: computeHealthScore({
      billed: Number(invoices._sum.totalMinor ?? 0n),
      paid: Number(invoices._sum.paidMinor ?? 0n),
      live: campaigns.filter((c) => c.lifecycle === "LIVE").length,
      contracts,
    }),
    synthesizedAt: new Date().toISOString(),
  };
  return upsertDigitalTwin(ctx, { subjectType: "CLIENT", subjectId: clientId, state });
}

function computeHealthScore(input: { billed: number; paid: number; live: number; contracts: number }): number {
  let score = 50;
  if (input.billed > 0) score += Math.round((input.paid / input.billed) * 30);
  score += Math.min(15, input.live * 5);
  score += Math.min(5, input.contracts * 5);
  return Math.max(0, Math.min(100, score));
}

/** Simulate a what-if scenario deterministically against a twin's state. */
export async function simulateTwin(ctx: Ctx, id: string, deltas: Record<string, number>) {
  const twin = await requireOwned(await db.digitalTwinModel.findUnique({ where: { id } }), "Digital twin", ctx.orgId);
  const state = { ...(twin.state as Record<string, number>) };
  const projected: Record<string, number> = {};
  for (const [k, d] of Object.entries(deltas)) {
    const base = Number(state[k] ?? 0);
    projected[k] = base + d;
  }
  return { twinId: id, subjectType: twin.subjectType, baseline: state, deltas, projected };
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

const FRAMEWORKS = ["GDPR", "CCPA", "HIPAA", "SOC2", "ISO27001", "CUSTOM"] as const;

export const compliancePolicySchema = z.object({
  code: codeish,
  name: nameish,
  framework: z.enum(FRAMEWORKS).default("CUSTOM"),
  rules: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertCompliancePolicy(ctx: Ctx, input: unknown, id?: string) {
  const data = compliancePolicySchema.parse(input);
  await assertWritable(ctx.orgId);
  if (id) {
    await requireOwned(await db.compliancePolicy.findUnique({ where: { id } }), "Compliance policy", ctx.orgId);
    return db.compliancePolicy.update({ where: { id }, data: { name: data.name, framework: data.framework as ComplianceFramework, rules: data.rules as object } });
  }
  return db.compliancePolicy
    .create({ data: { orgId: ctx.orgId, code: data.code, name: data.name, framework: data.framework as ComplianceFramework, rules: data.rules as object, createdById: ctx.userId } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A compliance policy with this code already exists");
    });
}

export async function listCompliancePolicies(ctx: Ctx) {
  return db.compliancePolicy.findMany({ where: { orgId: ctx.orgId }, orderBy: { updatedAt: "desc" } });
}

export async function toggleCompliancePolicy(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.compliancePolicy.findUnique({ where: { id } }), "Compliance policy", ctx.orgId);
  return db.compliancePolicy.update({ where: { id }, data: { active } });
}

export const complianceCheckSchema = z.object({
  subjectType: z.string().trim().min(1).max(40),
  subjectId: z.string().trim().min(1).max(64),
  facts: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Evaluate a policy's rules against supplied facts. Rules are
 * `{ requiredFacts: string[], forbidden: Record<string, unknown> }` style
 * declarative assertions; findings enumerate violations.
 */
export async function runComplianceCheck(ctx: Ctx, policyId: string, input: unknown) {
  const data = complianceCheckSchema.parse(input);
  const policy = await requireOwned(await db.compliancePolicy.findUnique({ where: { id: policyId } }), "Compliance policy", ctx.orgId);
  if (!policy.active) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Compliance policy is inactive");
  const rules = (policy.rules ?? {}) as { requiredFacts?: string[]; forbidden?: Record<string, unknown>; minConsent?: string };
  const findings: Array<{ rule: string; message: string }> = [];
  for (const fact of rules.requiredFacts ?? []) {
    if (data.facts[fact] === undefined || data.facts[fact] === null) findings.push({ rule: "requiredFacts", message: `missing fact "${fact}"` });
  }
  for (const [k, v] of Object.entries(rules.forbidden ?? {})) {
    if (data.facts[k] === v) findings.push({ rule: "forbidden", message: `forbidden value for "${k}"` });
  }
  if (rules.minConsent && data.facts.consent !== rules.minConsent) findings.push({ rule: "minConsent", message: `consent must be ${rules.minConsent}` });
  const status: ComplianceCheckStatus = findings.length === 0 ? "PASS" : findings.length > 2 ? "FAIL" : "WARN";
  const row = await db.complianceCheck.create({
    data: { policyId, orgId: ctx.orgId, subjectType: data.subjectType, subjectId: data.subjectId, status, findings: findings as object },
  });
  await audit(db, ctx, "compliance.checked", undefined, row.id, { status, findings: findings.length });
  return { check: row, status, findings };
}

export async function listComplianceChecks(ctx: Ctx, query: URLSearchParams) {
  const subjectType = query.get("subjectType") ?? undefined;
  const subjectId = query.get("subjectId") ?? undefined;
  const status = query.get("status") ?? undefined;
  return db.complianceCheck.findMany({
    where: { orgId: ctx.orgId, ...(subjectType ? { subjectType } : {}), ...(subjectId ? { subjectId } : {}), ...(status ? { status: status as ComplianceCheckStatus } : {}) },
    orderBy: { at: "desc" },
    take: 200,
  });
}

/** Seed a small set of baseline policies once per org (idempotent). */
export async function seedBaselineCompliance(ctx: Ctx) {
  const baselines = [
    { code: "GDPR_CONSENT", name: "GDPR consent required", framework: "GDPR" as const, rules: { minConsent: "OPT_IN", requiredFacts: ["consent"] } },
    { code: "CCPA_OPT_OUT", name: "CCPA opt-out honored", framework: "CCPA" as const, rules: { forbidden: { optOut: false } } },
  ];
  let created = 0;
  for (const b of baselines) {
    const exists = await db.compliancePolicy.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: b.code } } });
    if (exists) continue;
    await db.compliancePolicy.create({ data: { orgId: ctx.orgId, code: b.code, name: b.name, framework: b.framework, rules: b.rules as object, createdById: ctx.userId } });
    created++;
  }
  await emit(db, { type: "compliance.seeded", aggregateType: "OFFER", aggregateId: ctx.orgId, orgId: ctx.orgId, payload: { created } });
  return { created };
}

export const KNOWLEDGE_KIND_LIST = KNOWLEDGE_KINDS;
export const TWIN_SUBJECT_LIST = TWIN_SUBJECTS;
export const COMPLIANCE_FRAMEWORK_LIST = FRAMEWORKS;
