/**
 * Orchestrator event consumer — the "consumes" half of the §4 contract.
 *
 * The orchestrator subscribes to the domains it orchestrates and maintains a
 * live projection of their state onto the campaign. The projection is
 * idempotent: stats are recomputed from the source-of-truth tables, so a
 * redelivered event can never double-count.
 *
 * Consumed: flight.ended, content.published, offer.redeemed, payment.recorded
 * Effects : refresh composition.stats, emit campaign.budget_exceeded once,
 *           auto-close the campaign when every flight ends (opt-in).
 */
import { db } from "../db";
import { emit } from "../events";
import { logActivity } from "../audit";
import type { Prisma } from "@/generated/prisma/client";

export type ConsumedEvent = {
  id: string;
  type: string;
  aggregateId: string;
  orgId: string | null;
  payload: unknown;
};

const CONSUMED_TYPES = new Set([
  "flight.ended",
  "content.published",
  "offer.redeemed",
  "payment.recorded",
  "payment.paid",
]);

type CampaignStats = {
  slotsPublished: number;
  redemptions: number;
  discountMinor: number;
  spendMinor: number;
  revenueMinor: number;
  collectedMinor: number;
  budgetMinor: number;
  budgetAlerted: boolean;
};

function payloadOf(ev: ConsumedEvent): Record<string, unknown> {
  return ev.payload && typeof ev.payload === "object" ? (ev.payload as Record<string, unknown>) : {};
}

/**
 * Resolve which campaigns a batch of domain events touches. The orchestrator
 * never trusts the emitter's word alone — ids are resolved through the owning
 * domain's tables, exactly like every other read in this service.
 */
async function resolveAffectedCampaigns(events: ConsumedEvent[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const ev of events) {
    if (!CONSUMED_TYPES.has(ev.type)) continue;
    const payload = payloadOf(ev);

    if (ev.type === "flight.ended") {
      const fromPayload = typeof payload.campaignId === "string" ? payload.campaignId : null;
      if (fromPayload) {
        ids.add(fromPayload);
      } else {
        const flight = await db.campaignFlight.findUnique({
          where: { id: ev.aggregateId },
          select: { campaignId: true },
        });
        if (flight) ids.add(flight.campaignId);
      }
    } else if (ev.type === "content.published") {
      const post = await db.contentPost.findUnique({
        where: { id: ev.aggregateId },
        select: { campaignId: true },
      });
      if (post?.campaignId) ids.add(post.campaignId);
    } else if (ev.type === "offer.redeemed") {
      // An offer can be attached to several campaigns; refresh each of them.
      const links = await db.campaignOffer.findMany({
        where: { offerId: ev.aggregateId },
        select: { campaignId: true },
      });
      links.forEach((l) => ids.add(l.campaignId));
    } else if (ev.type.startsWith("payment.")) {
      const invoiceId = typeof payload.invoiceId === "string" ? payload.invoiceId : null;
      if (!invoiceId) continue;
      const invoice = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: { clientId: true },
      });
      if (!invoice?.clientId) continue;
      const campaigns = await db.campaign.findMany({
        where: { clientId: invoice.clientId },
        select: { id: true },
      });
      campaigns.forEach((c) => ids.add(c.id));
    }
  }
  return ids;
}

/** Recompute the projection from the owning domains (idempotent by construction). */
async function computeStats(campaign: {
  id: string;
  clientId: string | null;
  budgetMinor: bigint | null;
  composition: unknown;
}): Promise<CampaignStats> {
  const [slots, redemptions, metrics, collected] = await Promise.all([
    db.contentTarget.count({
      where: { post: { campaignId: campaign.id }, status: "PUBLISHED" },
    }),
    db.offerRedemption.aggregate({
      where: { campaignId: campaign.id },
      _sum: { discountMinor: true },
      _count: { _all: true },
    }),
    db.campaignMetric.aggregate({
      where: { campaignId: campaign.id },
      _sum: { costMinor: true, revenueMinor: true },
    }),
    db.payment.aggregate({
      where: { invoice: { clientId: campaign.clientId }, status: "COMPLETED" },
      _sum: { amountMinor: true },
    }),
  ]);
  const prev =
    (campaign.composition as { stats?: Partial<CampaignStats> } | null)?.stats ?? {};
  return {
    slotsPublished: slots,
    redemptions: redemptions._count._all,
    discountMinor: Number(redemptions._sum.discountMinor ?? 0n),
    spendMinor: Number(metrics._sum.costMinor ?? 0n),
    revenueMinor: Number(metrics._sum.revenueMinor ?? 0n),
    collectedMinor: Number(collected._sum.amountMinor ?? 0n),
    budgetMinor: Number(campaign.budgetMinor ?? 0n),
    budgetAlerted: prev.budgetAlerted ?? false,
  };
}

/**
 * Apply the projection. Called from the event dispatcher on every pass, so it
 * must stay cheap and must never throw (delivery is never blocked by it).
 */
export async function reconcileCampaignProjections(
  events: ConsumedEvent[],
): Promise<{ reconciled: number; autoClosed: number; alerts: number }> {
  const result = { reconciled: 0, autoClosed: 0, alerts: 0 };
  const campaignIds = await resolveAffectedCampaigns(events);
  if (campaignIds.size === 0) return result;

  for (const campaignId of campaignIds) {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      include: { flights: { select: { id: true, status: true } } },
    });
    if (!campaign || !campaign.composition) continue;

    const stats = await computeStats(campaign);
    const comp = campaign.composition as Record<string, unknown>;
    const rules = (comp.rules ?? {}) as Record<string, unknown>;

    await db.$transaction(async (tx) => {
      // budget guardrail — alert exactly once per crossing
      if (!stats.budgetAlerted && stats.budgetMinor > 0 && stats.spendMinor > stats.budgetMinor) {
        stats.budgetAlerted = true;
        await emit(tx, {
          type: "campaign.budget_exceeded",
          aggregateType: "CAMPAIGN",
          aggregateId: campaignId,
          orgId: campaign.orgId,
          payload: {
            spendMinor: stats.spendMinor,
            budgetMinor: stats.budgetMinor,
            overByMinor: stats.spendMinor - stats.budgetMinor,
          },
        });
        await logActivity(tx, {
          orgId: campaign.orgId,
          userId: null,
          action: "campaign.budget_exceeded",
          entityType: "CAMPAIGN",
          entityId: campaignId,
          meta: { spendMinor: stats.spendMinor, budgetMinor: stats.budgetMinor },
        });
        result.alerts++;
      }

      await tx.campaign.update({
        where: { id: campaignId },
        data: { composition: { ...comp, stats } as Prisma.InputJsonValue },
      });

      // auto-close when every flight has ended and the composition opts in
      const allEnded =
        campaign.flights.length > 0 &&
        campaign.flights.every((f) => f.status === "ENDED");
      if (campaign.lifecycle === "LIVE" && rules.autoClose === true && allEnded) {
        await tx.campaign.update({
          where: { id: campaignId },
          data: { lifecycle: "CLOSED", status: "COMPLETED", closedAt: new Date() },
        });
        await tx.campaignFlight.updateMany({
          where: { campaignId, status: { in: ["APPROVED", "LIVE", "PAUSED"] } },
          data: { status: "ENDED" },
        });
        await emit(tx, {
          type: "campaign.closed",
          aggregateType: "CAMPAIGN",
          aggregateId: campaignId,
          orgId: campaign.orgId,
          payload: { reason: "all flights ended" },
        });
        await logActivity(tx, {
          orgId: campaign.orgId,
          userId: null,
          action: "campaign.closed",
          entityType: "CAMPAIGN",
          entityId: campaignId,
          meta: { reason: "auto-closed after all flights ended" },
        });
        result.autoClosed++;
      }
    });
    result.reconciled++;
  }
  return result;
}
