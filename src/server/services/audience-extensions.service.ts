import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, nameish } from "../schemas";
import type { PredictiveKind, PreferenceKind } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Audience intelligence extensions: lookalike jobs, predictive scores
// and recipient preferences. Audience/Member aggregates stay in audiences.service.
// ===========================================================================

async function requireAudience(ctx: Ctx, id: string) {
  return requireOwned(await db.audience.findUnique({ where: { id } }), "Audience", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Lookalike jobs
// ---------------------------------------------------------------------------

export const lookalikeSchema = z.object({
  seedAudienceId: z.string().min(1),
  name: nameish,
  sizeRequested: z.number().int().min(10).max(500_000).default(1000),
  similarityBps: bpsSchema.default(8000),
  features: z.array(z.string().trim().max(40)).max(30).default([]),
});

export async function createLookalikeJob(ctx: Ctx, input: unknown) {
  const data = lookalikeSchema.parse(input);
  await assertWritable(ctx.orgId);
  const seed = await requireAudience(ctx, data.seedAudienceId);
  const members = await db.audienceMember.count({ where: { audienceId: seed.id, consent: { not: "EXPIRED" } } });
  if (members < 10) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Seed audience needs at least 10 consented members");
  const job = await db.lookalikeJob.create({
    data: { orgId: ctx.orgId, seedAudienceId: seed.id, name: data.name, sizeRequested: data.sizeRequested, similarityBps: data.similarityBps, features: data.features, status: "QUEUED", createdById: ctx.userId },
  });
  await audit(db, ctx, "lookalike.queued", undefined, job.id, { seedAudienceId: seed.id });
  return job;
}

/**
 * Deterministic lookalike expansion: expand the seed's trait distribution
 * (tags, company, domain) into a derived audience. Re-runnable; rebuilds the
 * result audience in place. No external model calls.
 */
export async function runLookalikeJob(ctx: Ctx, id: string) {
  const job = await requireOwned(await db.lookalikeJob.findUnique({ where: { id } }), "Lookalike job", ctx.orgId);
  if (job.status === "RUNNING") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Job is already running");
  await db.lookalikeJob.update({ where: { id }, data: { status: "RUNNING", error: null } });
  try {
    const seedMembers = await db.audienceMember.findMany({ where: { audienceId: job.seedAudienceId, orgId: ctx.orgId }, take: 5000 });
    if (seedMembers.length < 10) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Seed audience too small");
    const tagCounts = new Map<string, number>();
    for (const m of seedMembers) for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t);
    const companyCounts = new Map<string, number>();
    for (const m of seedMembers) if (m.company) companyCounts.set(m.company, (companyCounts.get(m.company) ?? 0) + 1);
    const topCompanies = new Set([...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([c]) => c));

    const pool = await db.audienceMember.findMany({
      where: { orgId: ctx.orgId, audienceId: { not: job.seedAudienceId }, consent: { not: "EXPIRED" } },
      take: 50_000,
    });
    const scored = pool
      .map((m) => {
        const tagOverlap = m.tags.filter((t) => topTags.includes(t)).length;
        const companyMatch = m.company && topCompanies.has(m.company) ? 1 : 0;
        const score = Math.min(10_000, tagOverlap * 1500 + companyMatch * 3000);
        return { m, score };
      })
      .filter((x) => x.score >= job.similarityBps)
      .sort((a, b) => b.score - a.score)
      .slice(0, job.sizeRequested);

    const result = await db.$transaction(async (tx) => {
      let resultAudienceId = job.resultAudienceId;
      if (!resultAudienceId) {
        const aud = await tx.audience.create({
          data: { orgId: ctx.orgId, name: `${job.name} (lookalike)`, kind: "LOOKALIKE_SEED", source: "MANUAL", createdById: ctx.userId },
        });
        resultAudienceId = aud.id;
      } else {
        await tx.audienceMember.deleteMany({ where: { audienceId: resultAudienceId } });
      }
      const seen = new Set<string>();
      for (const { m } of scored) {
        if (seen.has(m.identityKey)) continue;
        seen.add(m.identityKey);
        await tx.audienceMember.create({
          data: {
            audienceId: resultAudienceId,
            orgId: ctx.orgId,
            identityKey: m.identityKey,
            email: m.email,
            emailNormalized: m.emailNormalized,
            phone: m.phone,
            name: m.name,
            company: m.company,
            tags: m.tags,
            consent: m.consent,
          },
        });
      }
      const updated = await tx.lookalikeJob.update({
        where: { id },
        data: { status: "READY", resultAudienceId, finishedAt: new Date() },
      });
      await emit(tx, { type: "lookalike.ready", aggregateType: "AUDIENCE", aggregateId: resultAudienceId, orgId: ctx.orgId, payload: { jobId: id, matched: scored.length } });
      await audit(tx, ctx, "lookalike.ready", undefined, id, { matched: scored.length });
      return updated;
    });
    return { job: result, matched: scored.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookalike failed";
    await db.lookalikeJob.update({ where: { id }, data: { status: "FAILED", error: msg.slice(0, 500), finishedAt: new Date() } });
    throw e;
  }
}

export async function listLookalikeJobs(ctx: Ctx) {
  return db.lookalikeJob.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { seedAudience: { select: { id: true, name: true } } },
  });
}

export async function getLookalikeJob(ctx: Ctx, id: string) {
  return requireOwned(await db.lookalikeJob.findUnique({ where: { id } }), "Lookalike job", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Predictive scores
// ---------------------------------------------------------------------------

const PREDICTIVE_KINDS = ["CHURN", "CONVERSION", "LIFETIME_VALUE", "ENGAGEMENT", "NEXT_BEST_ACTION"] as const;

export const predictiveSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(PREDICTIVE_KINDS),
  campaignId: z.string().max(64).nullable().optional(),
  features: z.record(z.string(), z.unknown()).default({}),
});

/** Deterministic scoring from supplied features; the formula is explicit and auditable. */
export async function computePredictiveScore(ctx: Ctx, input: unknown) {
  const data = predictiveSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.campaignId) await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
  const f = data.features as Record<string, number | undefined>;
  const clamp = (n: number) => Math.max(0, Math.min(10_000, Math.round(n)));
  let scoreBps = 5000;
  let model = "heuristic-v1";
  switch (data.kind) {
    case "CHURN":
      scoreBps = clamp(5000 + (f.daysSinceActive ?? 0) * 30 - (f.purchases ?? 0) * 200 - (f.sessions30d ?? 0) * 40);
      break;
    case "CONVERSION":
      scoreBps = clamp(3000 + (f.sessions30d ?? 0) * 150 + (f.emailClicks ?? 0) * 200 + (f.cartValue ?? 0) * 5);
      break;
    case "LIFETIME_VALUE":
      scoreBps = clamp(1000 + (f.avgOrderValue ?? 0) * 2 + (f.orders ?? 0) * 120);
      break;
    case "ENGAGEMENT":
      scoreBps = clamp(2000 + (f.opens ?? 0) * 100 + (f.clicks ?? 0) * 250 + (f.replies ?? 0) * 400);
      break;
    default:
      model = "rule-based-nba-v1";
      scoreBps = clamp(
        (f.daysSinceActive ?? 0) > 60 ? 9000 : (f.cartValue ?? 0) > 0 ? 7000 : (f.sessions30d ?? 0) > 3 ? 5000 : 3000,
      );
  }
  const row = await db.predictiveScore.create({
    data: { orgId: ctx.orgId, campaignId: data.campaignId ?? null, subjectKey: data.subjectKey, kind: data.kind as PredictiveKind, scoreBps, model, features: data.features as object },
  });
  return row;
}

export async function listPredictiveScores(ctx: Ctx, query: URLSearchParams) {
  const kind = query.get("kind") ?? undefined;
  const subjectKey = query.get("subjectKey") ?? undefined;
  const campaignId = query.get("campaignId") ?? undefined;
  return db.predictiveScore.findMany({
    where: { orgId: ctx.orgId, ...(kind ? { kind: kind as PredictiveKind } : {}), ...(subjectKey ? { subjectKey } : {}), ...(campaignId ? { campaignId } : {}) },
    orderBy: { computedAt: "desc" },
    take: 300,
  });
}

/** Top-N subjects for a kind, useful for next-best-action targeting. */
export async function topPredictiveSubjects(ctx: Ctx, kind: PredictiveKind, limit = 50) {
  const rows = await db.predictiveScore.findMany({ where: { orgId: ctx.orgId, kind }, orderBy: { scoreBps: "desc" }, take: Math.min(200, limit) });
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!best.has(r.subjectKey)) best.set(r.subjectKey, r);
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Recipient preferences (channel/timezone/frequency/topic/opt-out)
// ---------------------------------------------------------------------------

export const preferenceSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(["CHANNEL", "TIMEZONE", "CONTENT_LANGUAGE", "FREQUENCY", "TOPIC", "OPT_OUT"]),
  value: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().max(40).default("manual"),
});

export async function setRecipientPreference(ctx: Ctx, input: unknown) {
  const data = preferenceSchema.parse(input);
  const row = await db.recipientPreference.upsert({
    where: { orgId_subjectKey_kind: { orgId: ctx.orgId, subjectKey: data.subjectKey, kind: data.kind as PreferenceKind } },
    create: { orgId: ctx.orgId, subjectKey: data.subjectKey, kind: data.kind as PreferenceKind, value: data.value as object, source: data.source },
    update: { value: data.value as object, source: data.source },
  });
  await audit(db, ctx, "preference.set", undefined, row.id, { kind: data.kind });
  return row;
}

export async function listRecipientPreferences(ctx: Ctx, subjectKey: string) {
  return db.recipientPreference.findMany({ where: { orgId: ctx.orgId, subjectKey }, orderBy: { kind: "asc" } });
}

export async function suppressSubject(ctx: Ctx, subjectKey: string, reason = "manual opt-out") {
  return setRecipientPreference(ctx, { subjectKey, kind: "OPT_OUT", value: { reason, at: new Date().toISOString() }, source: "manual" });
}

export async function isSubjectSuppressed(ctx: Ctx, subjectKey: string): Promise<boolean> {
  const row = await db.recipientPreference.findUnique({ where: { orgId_subjectKey_kind: { orgId: ctx.orgId, subjectKey, kind: "OPT_OUT" } } });
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Audience enrichment rollup
// ---------------------------------------------------------------------------

export async function audienceEnrichment(ctx: Ctx, audienceId: string) {
  await requireAudience(ctx, audienceId);
  const [byConsent, withPhone, withCompany, jobs, scores] = await Promise.all([
    db.audienceMember.groupBy({ by: ["consent"], where: { audienceId, orgId: ctx.orgId }, _count: true }),
    db.audienceMember.count({ where: { audienceId, orgId: ctx.orgId, phone: { not: null } } }),
    db.audienceMember.count({ where: { audienceId, orgId: ctx.orgId, company: { not: null } } }),
    db.lookalikeJob.count({ where: { orgId: ctx.orgId, seedAudienceId: audienceId } }),
    db.predictiveScore.count({ where: { orgId: ctx.orgId } }),
  ]);
  return {
    audienceId,
    consent: Object.fromEntries(byConsent.map((c) => [c.consent, c._count])),
    enrichment: { withPhone, withCompany, coverageBps: byConsent.reduce((a, c) => a + c._count, 0) > 0 ? Math.round(((withPhone + withCompany) / (byConsent.reduce((a, c) => a + c._count, 0) * 2)) * 10_000) : 0 },
    lookalikeJobs: jobs,
    predictiveScores: scores,
  };
}
