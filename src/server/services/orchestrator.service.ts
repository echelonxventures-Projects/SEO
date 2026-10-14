import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { moneySchema, dateSchema } from "../schemas";
import { toMinor } from "../money";
import type { CampaignLifecycle } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { audit, requireOwned } from "./common";
import { emit } from "../events";

/**
 * §4 Campaign Orchestrator. Owns only the Campaign aggregate; everything
 * else is a validated reference into its owning domain.
 */

const LIFECYCLE: Record<CampaignLifecycle, CampaignLifecycle[]> = {
  DRAFT: ["PLANNED", "PENDING_APPROVAL"],
  PLANNED: ["PENDING_APPROVAL", "DRAFT"],
  PENDING_APPROVAL: ["APPROVED", "PLANNED"],
  APPROVED: ["LIVE", "PLANNED"],
  LIVE: ["CLOSED"],
  CLOSED: ["LEARNED"],
  LEARNED: [],
};

export const compositionSchema = z.object({
  objective: z.string().trim().min(3).max(500),
  channelIds: z.array(z.string().min(1)).min(1).max(12),
  audienceId: z.string().max(64).nullable().default(null),
  contentPostIds: z.array(z.string()).max(50).default([]),
  offerIds: z.array(z.string()).max(10).default([]),
  startsAt: dateSchema,
  endsAt: dateSchema,
  budget: moneySchema,
  rules: z.record(z.string(), z.unknown()).default({}),
});

async function requireCampaign(ctx: Ctx, id: string) {
  return requireOwned(
    await db.campaign.findUnique({
      where: { id },
      include: {
        flights: { select: { id: true, channelId: true, status: true } },
        metrics: { select: { date: true, costMinor: true, revenueMinor: true, clicks: true, impressions: true, conversions: true } },
      },
    }),
    "Campaign",
    ctx.orgId,
  );
}

/** Validate every reference against its owning domain (read-only). */
async function validateComposition(ctx: Ctx, comp: z.infer<typeof compositionSchema>) {
  if (new Date(comp.endsAt) <= new Date(comp.startsAt)) {
    throw new AppError(ErrorCodes.VALIDATION, "Composition window invalid: endsAt must be after startsAt");
  }
  const channels = await db.channel.findMany({ where: { id: { in: comp.channelIds }, OR: [{ orgId: ctx.orgId }, { orgId: null }] } });
  if (channels.length !== new Set(comp.channelIds).size) throw new AppError(ErrorCodes.VALIDATION, "Unknown channel in composition");
  for (const ch of channels) {
    if (!ch.active) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Channel "${ch.name}" is disabled`);
    if (ch.requiresConnection) {
      const n = await db.socialConnection.count({ where: { orgId: ctx.orgId, connectorKey: ch.connectorKey ?? "", status: "CONNECTED" } });
      if (n === 0) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Channel "${ch.name}" needs a connected account before planning`);
    }
  }
  if (comp.audienceId) {
    const a = await requireOwned(await db.audience.findUnique({ where: { id: comp.audienceId } }), "Audience", ctx.orgId);
    if (a.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Audience is archived");
  }
  if (comp.contentPostIds.length) {
    const posts = await db.contentPost.count({ where: { id: { in: comp.contentPostIds }, orgId: ctx.orgId } });
    if (posts !== new Set(comp.contentPostIds).size) throw new AppError(ErrorCodes.VALIDATION, "Unknown content post in composition");
  }
  if (comp.offerIds.length) {
    const offers = await db.offer.count({ where: { id: { in: comp.offerIds }, orgId: ctx.orgId, status: { in: ["ACTIVE", "PUBLISHED"] } } });
    if (offers !== new Set(comp.offerIds).size) throw new AppError(ErrorCodes.VALIDATION, "Offers must exist and be published/active");
  }
  return { channels, audienceId: comp.audienceId };
}

export async function planCampaign(ctx: Ctx, campaignId: string, input: unknown) {
  const comp = compositionSchema.parse(input);
  const campaign = await requireCampaign(ctx, campaignId);
  if (!["DRAFT", "PLANNED"].includes(campaign.lifecycle)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Cannot re-plan a ${campaign.lifecycle.toLowerCase()} campaign`);
  }
  const { channels } = await validateComposition(ctx, comp);
  const budgetMinor = toMinor(comp.budget);

  await db.$transaction(async (tx) => {
    // ensure a flight exists per channel (create/update windows); flights stay owned by Calendar domain
    for (const ch of channels) {
      const existing = campaign.flights.find((f) => f.channelId === ch.id);
      if (existing) {
        await tx.campaignFlight.update({
          where: { id: existing.id },
          data: { startsAt: new Date(comp.startsAt), endsAt: new Date(comp.endsAt), audienceId: comp.audienceId ?? null },
        });
      } else {
        await tx.campaignFlight.create({
          data: {
            campaignId,
            orgId: ctx.orgId,
            channelId: ch.id,
            audienceId: comp.audienceId ?? null,
            startsAt: new Date(comp.startsAt),
            endsAt: new Date(comp.endsAt),
            createdById: ctx.userId,
          },
        });
      }
    }
    // retire flights on channels removed from composition
    for (const f of campaign.flights.filter((x) => !comp.channelIds.includes(x.channelId) && x.status === "DRAFT")) {
      await tx.campaignFlight.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
    }
    // offers link
    await tx.campaignOffer.deleteMany({ where: { campaignId } });
    for (const offerId of planUnique(comp.offerIds)) {
      await tx.campaignOffer.create({ data: { campaignId, offerId, addedById: ctx.userId } });
    }
    // content attach
    if (comp.contentPostIds.length) {
      await tx.contentPost.updateMany({ where: { id: { in: comp.contentPostIds }, orgId: ctx.orgId }, data: { campaignId } });
    }
    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        lifecycle: "PLANNED",
        composition: { ...comp, budgetMinor: Number(budgetMinor), channels: channels.map((c) => ({ id: c.id, name: c.name })) } as object,
        budgetMinor,
        startDate: new Date(comp.startsAt),
        endDate: new Date(comp.endsAt),
        plannedAt: new Date(),
      },
    });
    await emit(tx, {
      type: "campaign.planned",
      aggregateType: "CAMPAIGN",
      aggregateId: campaignId,
      orgId: ctx.orgId,
      payload: { objective: comp.objective, channels: channels.length, budgetMinor: Number(budgetMinor) },
    });
    await audit(tx, ctx, "campaign.planned", "CAMPAIGN", campaignId, { channels: channels.length });
  });
  return { ok: true };
}

function planUnique(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/** Budget-vs-spend guardrail: recorded channel spend must not exceed budget. */
export async function budgetGuardrail(campaign: {
  id: string;
  budgetMinor: bigint | null;
}): Promise<{ budgetMinor: bigint; spendMinor: bigint; exceeded: boolean }> {
  const spend = await db.campaignMetric.aggregate({
    where: { campaignId: campaign.id },
    _sum: { costMinor: true },
  });
  const spendMinor = spend._sum.costMinor ?? 0n;
  const budgetMinor = campaign.budgetMinor ?? 0n;
  return { budgetMinor, spendMinor, exceeded: budgetMinor > 0n && spendMinor > budgetMinor };
}

export async function transitionCampaign(ctx: Ctx, campaignId: string, to: CampaignLifecycle) {
  const campaign = await requireCampaign(ctx, campaignId);
  if (!LIFECYCLE[campaign.lifecycle].includes(to)) {
    throw new AppError(
      ErrorCodes.ILLEGAL_STATE,
      `Campaign cannot go ${campaign.lifecycle.toLowerCase()} → ${to.toLowerCase()} (allowed: ${LIFECYCLE[campaign.lifecycle].join(", ").toLowerCase() || "none"})`,
    );
  }
  if (to === "PENDING_APPROVAL" && !campaign.composition) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Plan the composition before requesting approval");
  }
  if (to === "APPROVED") {
    // Separation of duty: approving a launch needs campaign.approve, not just
    // campaign.write — the planner cannot approve their own plan.
    if (!ctx.viewer.active?.permissions.has("campaign.approve")) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Missing permission: campaign.approve — ask an owner/admin to approve the launch");
    }
  }
  if (to === "LIVE") {
    // launch gates: approved flights/audience/channel readiness already checked at plan time
    const flights = campaign.flights.filter((f) => !["ENDED", "CANCELLED", "SKIPPED"].includes(f.status));
    if (flights.length === 0) throw new AppError(ErrorCodes.ILLEGAL_STATE, "No active flights to launch");
    const guard = await budgetGuardrail(campaign);
    if (guard.exceeded) {
      throw new AppError(
        ErrorCodes.ILLEGAL_STATE,
        `Budget guardrail: recorded spend (${guard.spendMinor} minor) already exceeds the campaign budget (${guard.budgetMinor} minor). Raise the budget before launching.`,
      );
    }
  }
  const stampFields: Partial<Record<CampaignLifecycle, Record<string, Date | string>>> = {
    APPROVED: { approvedAt: new Date() },
    LIVE: { launchedAt: new Date() },
    CLOSED: { closedAt: new Date() },
    LEARNED: { learnedAt: new Date() },
  };
  await db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { lifecycle: to, status: to === "LIVE" ? "LIVE" : to === "CLOSED" || to === "LEARNED" ? "COMPLETED" : campaign.status, ...(stampFields[to] ?? {}) },
    });
    if (to === "LIVE") {
      await tx.campaignFlight.updateMany({ where: { campaignId, status: "APPROVED" }, data: { status: "LIVE" } });
    }
    if (to === "CLOSED") {
      await tx.campaignFlight.updateMany({ where: { campaignId, status: { in: ["APPROVED", "LIVE", "PAUSED"] } }, data: { status: "ENDED" } });
    }
    await emit(tx, { type: `campaign.${to.toLowerCase()}`, aggregateType: "CAMPAIGN", aggregateId: campaignId, orgId: ctx.orgId, payload: {} });
    await audit(tx, ctx, `campaign.${to.toLowerCase()}`, "CAMPAIGN", campaignId);
  });
  return { ok: true };
}

/**
 * §15 predictive seed: deterministic simulation from composition —
 * audience size × channel benchmarks; no external calls, clearly model-based.
 */
export async function simulateCampaign(ctx: Ctx, campaignId: string) {
  const campaign = await requireCampaign(ctx, campaignId);
  const comp = campaign.composition as z.infer<typeof compositionSchema> & { budgetMinor?: number } | null;
  if (!comp) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Plan the campaign before simulating");
  const audienceSize = comp.audienceId
    ? await db.audienceMember.count({ where: { audienceId: comp.audienceId, consent: { not: "EXPIRED" } } })
    : 25_000;
  const channels = await db.channel.findMany({ where: { id: { in: comp.channelIds } } });
  const days = Math.max(1, Math.round((new Date(comp.endsAt).getTime() - new Date(comp.startsAt).getTime()) / 86400_000));
  const budgetMinor = comp.budgetMinor ?? Number(campaign.budgetMinor ?? 0n);
  const perChannel = channels.length ? Math.floor(budgetMinor / channels.length) : 0;
  const BENCH: Record<string, { ctrBps: number; cvrBps: number; cpcMinor: number; reachPerDay: number }> = {
    SEARCH: { ctrBps: 350, cvrBps: 400, cpcMinor: 6000, reachPerDay: 12_000 },
    SOCIAL: { ctrBps: 120, cvrBps: 150, cpcMinor: 3500, reachPerDay: 8_000 },
    EMAIL: { ctrBps: 2500, cvrBps: 250, cpcMinor: 300, reachPerDay: 0 },
    DISPLAY: { ctrBps: 60, cvrBps: 50, cpcMinor: 800, reachPerDay: 40_000 },
    VIDEO: { ctrBps: 180, cvrBps: 120, cpcMinor: 2500, reachPerDay: 20_000 },
    ORGANIC: { ctrBps: 0, cvrBps: 0, cpcMinor: 0, reachPerDay: 1_500 },
  };
  const rows = channels.map((ch) => {
    const b = BENCH[ch.kind] ?? BENCH.DISPLAY;
    const reach = ch.kind === "EMAIL" ? audienceSize : Math.round((b.reachPerDay * days) / Math.max(1, channels.length / 2));
    const spendCap = ch.kind === "ORGANIC" || ch.kind === "EMAIL" ? 0 : perChannel;
    const clicks = Math.round((reach * b.ctrBps) / 10_000);
    const paidClicks = b.cpcMinor > 0 ? Math.min(clicks, Math.floor(spendCap / b.cpcMinor) || clicks) : clicks;
    const conversions = Math.round((paidClicks * b.cvrBps) / 10_000);
    return { channel: ch.name, kind: ch.kind, reach, clicks: paidClicks, conversions, estSpendMinor: paidClicks * b.cpcMinor };
  });
  const totals = rows.reduce((a, r) => ({ reach: a.reach + r.reach, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions }), { reach: 0, clicks: 0, conversions: 0 });
  const avgOrder = 150_000; // ₹1,500 default — replace with client-level AOV when orders domain lands
  return {
    method: "deterministic-channel-benchmark v1",
    window: { days },
    audience: { id: comp.audienceId ?? null, size: audienceSize },
    channels: rows,
    totals: { ...totals, estRevenueMinor: totals.conversions * avgOrder, estSpendMinor: rows.reduce((a, r) => a + r.estSpendMinor, 0) },
    note: "Simulation model — figures are estimates, not guarantees.",
  };
}

/** §4 Close → Learn: deterministic retrospective rollup persisted for reuse. */
export async function learnCampaign(ctx: Ctx, campaignId: string) {
  const campaign = await requireCampaign(ctx, campaignId);
  if (campaign.lifecycle !== "CLOSED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Close the campaign before learning");
  const [spend, slots, redemptions, flights, channelLinks] = await Promise.all([
    db.campaignMetric.aggregate({ where: { campaignId }, _sum: { costMinor: true, revenueMinor: true, clicks: true, conversions: true } }),
    db.contentTarget.count({ where: { post: { campaignId }, status: "PUBLISHED" } }),
    db.offerRedemption.aggregate({ where: { campaignId }, _sum: { discountMinor: true }, _count: { _all: true } }),
    db.campaignFlight.count({ where: { campaignId, status: "ENDED" } }),
    db.channel.findMany({
      where: { id: { in: (campaign.composition as { channelIds?: string[] } | null)?.channelIds ?? [] } },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const cost = spend._sum.costMinor ?? 0n;
  const rev = spend._sum.revenueMinor ?? 0n;
  const summary = {
    spendMinor: Number(cost),
    revenueMinor: Number(rev),
    roas: cost > 0n ? Number(rev) / Number(cost) : null,
    clicks: Number(spend._sum.clicks ?? 0),
    conversions: Number(spend._sum.conversions ?? 0),
    slotsPublished: slots,
    redemptions: redemptions._count._all,
    discountGivenMinor: Number(redemptions._sum.discountMinor ?? 0n),
    endedFlights: flights,
    channels: channelLinks.map((c) => c.name),
  };
  const learnings = {
    wins: [
      cost > 0n && rev > cost ? `Campaign returned ${Number(rev > cost ? (Number(rev) / Number(cost)) : 0).toFixed(2)}x on spend` : null,
      slots > 0 ? `${slots} content slots published` : null,
      redemptions._count._all > 0 ? `${redemptions._count._all} offer redemptions` : null,
      flights > 0 ? `${flights} flights completed cleanly` : null,
    ].filter(Boolean),
    watchouts: [
      cost === 0n && rev === 0n ? "No metrics recorded — wire channel tracking before the next cycle" : null,
      cost > 0n && rev < cost ? "ROAS below 1: review creatives, audiences, or channel mix" : null,
      redemptions._count._all === 0 && channelLinks.length > 0 ? "Offers attached but never redeemed — check codes were distributed" : null,
    ].filter(Boolean),
  };
  await db.$transaction(async (tx) => {
    await tx.learningsSnapshot.upsert({
      where: { campaignId },
      create: { orgId: ctx.orgId, campaignId, summary: summary as object, learnings: learnings as object, createdById: ctx.userId },
      update: { summary: summary as object, learnings: learnings as object },
    });
    await tx.campaign.update({ where: { id: campaignId }, data: { lifecycle: "LEARNED", learnedAt: new Date() } });
    await emit(tx, { type: "campaign.learned", aggregateType: "CAMPAIGN", aggregateId: campaignId, orgId: ctx.orgId, payload: summary as Record<string, unknown> });
    await audit(tx, ctx, "campaign.learned", "CAMPAIGN", campaignId);
  });
  return { summary, learnings };
}

export async function getOrchestration(ctx: Ctx, campaignId: string) {
  const campaign = await requireCampaign(ctx, campaignId);
  const learnings = await db.learningsSnapshot.findUnique({ where: { campaignId } });
  return {
    lifecycle: campaign.lifecycle,
    composition: campaign.composition,
    timestamps: {
      plannedAt: campaign.plannedAt, approvedAt: campaign.approvedAt, launchedAt: campaign.launchedAt, closedAt: campaign.closedAt, learnedAt: campaign.learnedAt,
    },
    flights: campaign.flights,
    offers: await db.campaignOffer.findMany({ where: { campaignId }, include: { offer: { select: { id: true, code: true, name: true, status: true } } } }),
    guardrail: await budgetGuardrail(campaign),
    learnings,
    allowedTransitions: LIFECYCLE[campaign.lifecycle],
  };
}
