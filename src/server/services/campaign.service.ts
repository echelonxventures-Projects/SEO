import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { dateSchema, enumFilter, moneySchema, nameish, paginationSchema, skipTake } from "../schemas";
import { toMinor } from "../money";
import type { Ctx } from "./common";
import { assertFeature, assertWritable, audit, requireOwned } from "./common";

const CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;

export const campaignSchema = z.object({
  clientId: z.string().min(1).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  channelId: z.string().min(1).nullable().optional(),
  mediaChannelId: z.string().max(64).nullable().optional(),
  name: nameish,
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  budget: moneySchema.nullable().optional(),
  externalRef: z.string().trim().max(120).nullable().optional(),
});

export async function listCampaigns(ctx: Ctx, query: URLSearchParams) {
  await assertFeature(ctx.orgId, "CAMPAIGN_METRICS");
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const where = {
    orgId: ctx.orgId,
    status: enumFilter(status, CAMPAIGN_STATUSES),
    ...(p.q ? { name: { contains: p.q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.campaign.findMany({
      where,
      ...skipTake(p),
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } },
        mediaChannel: { select: { id: true, name: true, kind: true } },
        currency: true,
        metrics: { orderBy: { date: "desc" }, take: 1 },
      },
    }),
    db.campaign.count({ where }),
  ]);
  const sums = await db.campaignMetric.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: rows.map((r) => r.id) } },
    _sum: { costMinor: true, clicks: true, impressions: true, conversions: true, revenueMinor: true },
  });
  const EMPTY = { costMinor: 0n, clicks: 0n, impressions: 0n, conversions: 0n, revenueMinor: 0n };
  const byId = new Map(sums.map((s) => [s.campaignId, s._sum]));
  return {
    total,
    page: p.page,
    pageSize: p.pageSize,
    rows: rows.map((r) => {
      const s = byId.get(r.id) ?? EMPTY;
      return {
        ...r,
        totals: {
          costMinor: s.costMinor ?? 0n,
          clicks: Number(s.clicks ?? 0),
          impressions: Number(s.impressions ?? 0),
          conversions: Number(s.conversions ?? 0),
          revenueMinor: s.revenueMinor ?? 0n,
        },
      };
    }),
  };
}

function defaultCategoryFor(code: string): string {
  const map: Record<string, string> = {
    GOOGLE_SEARCH: "GOOGLE_ADS", META_ADS: "META_ADS", LINKEDIN_ADS: "LINKEDIN_ADS", YOUTUBE: "YOUTUBE",
  };
  return map[code] ?? code;
}

export async function createCampaign(ctx: Ctx, input: unknown) {
  const data = campaignSchema.parse(input);
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "CAMPAIGN_METRICS");
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const mediaChannelId: string | null = data.mediaChannelId ?? null;
  let legacyChannelId: string | null = data.channelId ?? null;
  if (mediaChannelId) {
    const { assertChannelUsable } = await import("./channels.service");
    const usable = await assertChannelUsable(db, ctx.orgId, mediaChannelId);
    if (!legacyChannelId) {
      legacyChannelId =
        (await db.category.findFirst({ where: { kind: "CAMPAIGN_CHANNEL", code: defaultCategoryFor(usable.code), OR: [{ orgId: null }, { orgId: ctx.orgId }] } }))?.id ?? null;
    }
  }
  if (!mediaChannelId && legacyChannelId) {
    const channel = await db.category
      .findFirst({ where: { id: legacyChannelId, kind: "CAMPAIGN_CHANNEL" } })
      .catch(() => null);
    if (!channel || (channel.orgId !== ctx.orgId && channel.orgId !== null)) {
      throw new AppError(ErrorCodes.VALIDATION, "Legacy channel must be a CAMPAIGN_CHANNEL category");
    }
  }
  if (!mediaChannelId && !legacyChannelId) {
    throw new AppError(ErrorCodes.VALIDATION, "Pick at least one channel");
  }
  if (data.projectId) {
    await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  }
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const campaign = await db.campaign.create({
    data: {
      orgId: ctx.orgId,
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      channelId: legacyChannelId,
      mediaChannelId,
      name: data.name,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      budgetMinor: data.budget != null ? toMinor(data.budget) : null,
      currencyCode: org.defaultCurrencyCode,
      externalRef: data.externalRef ?? null,
    },
  });
  await audit(db, ctx, "campaign.created", "CAMPAIGN", campaign.id, { name: campaign.name });
  return campaign;
}

export async function updateCampaign(ctx: Ctx, id: string, input: unknown) {
  const data = campaignSchema.partial().extend({ status: z.enum(CAMPAIGN_STATUSES).optional() }).parse(input);
  await requireOwned(await db.campaign.findUnique({ where: { id } }), "Campaign", ctx.orgId);
  const campaign = await db.campaign.update({
    where: { id },
    data: {
      name: data.name,
      status: data.status,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      budgetMinor: data.budget != null ? toMinor(data.budget) : undefined,
      externalRef: data.externalRef,
    },
  });
  await audit(db, ctx, "campaign.updated", "CAMPAIGN", id);
  return campaign;
}

export const metricSchema = z.object({
  date: dateSchema,
  impressions: z.number().int().min(0).max(1_000_000_000).default(0),
  clicks: z.number().int().min(0).max(1_000_000_000).default(0),
  cost: moneySchema.default(0),
  conversions: z.number().int().min(0).max(1_000_000).default(0),
  revenue: moneySchema.default(0),
});

export async function upsertMetric(ctx: Ctx, campaignId: string, input: unknown) {
  const data = metricSchema.parse(input);
  const campaign = await requireOwned(
    await db.campaign.findUnique({ where: { id: campaignId } }),
    "Campaign",
    ctx.orgId,
  );
  const date = new Date(data.date);
  date.setUTCHours(0, 0, 0, 0);
  const metric = await db.campaignMetric.upsert({
    where: { campaignId_date: { campaignId, date } },
    create: {
      campaignId,
      orgId: ctx.orgId,
      date,
      impressions: BigInt(data.impressions),
      clicks: BigInt(data.clicks),
      costMinor: toMinor(data.cost),
      conversions: BigInt(data.conversions),
      revenueMinor: toMinor(data.revenue),
    },
    update: {
      impressions: BigInt(data.impressions),
      clicks: BigInt(data.clicks),
      costMinor: toMinor(data.cost),
      conversions: BigInt(data.conversions),
      revenueMinor: toMinor(data.revenue),
    },
  });
  await audit(db, ctx, "campaign.metric_updated", "CAMPAIGN", campaign.id, { date: data.date });
  return metric;
}

export async function getCampaignDetail(ctx: Ctx, id: string) {
  const campaign = await requireOwned(
    await db.campaign.findUnique({
      where: { id },
      include: {
      client: true,
      channel: true,
      mediaChannel: { select: { name: true } },
      audience: { select: { id: true, name: true } },
      currency: true,
      project: { select: { id: true, name: true } },
      flights: {
        include: {
          channel: { select: { id: true, code: true, name: true, kind: true } },
          audience: { select: { id: true, name: true } },
        },
        orderBy: { startsAt: "asc" },
      },
    },
    }),
    "Campaign",
    ctx.orgId,
  );
  const metrics = await db.campaignMetric.findMany({ where: { campaignId: id }, orderBy: { date: "asc" } });
  const totals = metrics.reduce(
    (a, m) => ({
      impressions: a.impressions + Number(m.impressions),
      clicks: a.clicks + Number(m.clicks),
      costMinor: a.costMinor + m.costMinor,
      conversions: a.conversions + Number(m.conversions),
      revenueMinor: a.revenueMinor + m.revenueMinor,
    }),
    { impressions: 0, clicks: 0, costMinor: 0n, conversions: 0, revenueMinor: 0n },
  );
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpcMinor = totals.clicks ? Number(totals.costMinor) / totals.clicks : 0;
  const roas = totals.costMinor > 0n ? Number(totals.revenueMinor) / Number(totals.costMinor) : 0;
  return { campaign, metrics, derived: { ctrPct: Math.round(ctr * 100) / 100, cpcMinor: Math.round(cpcMinor), roas: Math.round(roas * 100) / 100 }, totals, flights: campaign.flights };
}
