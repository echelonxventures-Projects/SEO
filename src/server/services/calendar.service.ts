import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { toMinor } from "../money";
import { dateSchema, longText, moneySchema, nameish } from "../schemas";
import type { Ctx } from "./common";
import { audit, requireOwned } from "./common";
import { assertChannelUsable } from "./channels.service";
import { logActivity } from "../audit";
import { emit } from "../events";
import { expandPattern } from "./temporal-frame";
import type { Prisma } from "@/generated/prisma/client";

const WINDOW = { startsAt: dateSchema, endsAt: dateSchema };

export const flightSchema = z.object({
  campaignId: z.string().min(1),
  channelId: z.string().min(1),
  audienceId: z.string().max(64).nullable().optional(),
  patternId: z.string().max(64).nullable().optional(), // UTP temporal asset — the canonical cadence
  ...WINDOW,
  timezone: z.string().trim().max(60).default("Asia/Kolkata"),
  budget: moneySchema.nullable().optional(),
  cadence: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      time: z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
    })
    .nullable()
    .optional(),
  notes: longText.nullable().optional(),
});

function validateWindow(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw new AppError(ErrorCodes.VALIDATION, "End date must be after start date");
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86400_000) {
    throw new AppError(ErrorCodes.VALIDATION, "Flights are limited to 366 days");
  }
}

async function requireCampaign(ctx: Ctx, id: string) {
  return requireOwned(await db.campaign.findUnique({ where: { id } }), "Campaign", ctx.orgId);
}

export async function createFlight(ctx: Ctx, input: unknown) {
  const data = flightSchema.parse(input);
  const campaign = await requireCampaign(ctx, data.campaignId);
  await assertChannelUsable(db, ctx.orgId, data.channelId);
  if (data.audienceId) {
    const a = await requireOwned(await db.audience.findUnique({ where: { id: data.audienceId } }), "Audience", ctx.orgId);
    if (a.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Audience is archived");
  }
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  validateWindow(startsAt, endsAt);
  if (data.patternId) {
    const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
    if (pat.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Pattern is archived");
  }
  const overlaps = await findOverlaps(ctx.orgId, data.channelId, startsAt, endsAt, null);
  const flight = await db.campaignFlight.create({
    data: {
      campaignId: campaign.id,
      orgId: ctx.orgId,
      channelId: data.channelId,
      audienceId: data.audienceId ?? null,
      patternId: data.patternId ?? null,
      startsAt,
      endsAt,
      timezone: data.timezone,
      budgetMinor: data.budget != null ? toMinor(data.budget) : null,
      cadence: (data.cadence ?? undefined) as object,
      notes: data.notes ?? null,
      createdById: ctx.userId,
    },
    include: { channel: { select: { id: true, code: true, name: true, kind: true } }, pattern: { select: { id: true, name: true, dsl: true } } },
  });
  await audit(db, ctx, "flight.created", "CAMPAIGN", campaign.id, { flightId: flight.id, overlaps: overlaps.length });
  return { flight, warnings: overlaps.map((o) => `Overlaps flight ${o.id.slice(-6)} on ${o.channelName} (${o.status})`) };
}

export async function listFlights(ctx: Ctx, campaignId?: string) {
  return db.campaignFlight.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { startsAt: "desc" },
    include: {
      channel: { select: { id: true, code: true, name: true, kind: true, utmMedium: true } },
      audience: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true, clientId: true } },
      pattern: { select: { id: true, name: true, dsl: true, freq: true } },
    },
    take: 200,
  });
}

export async function updateFlight(ctx: Ctx, id: string, input: unknown) {
  const data = flightSchema.partial().omit({ campaignId: true, channelId: true }).parse(input);
  const flight = await requireOwned(await db.campaignFlight.findUnique({ where: { id } }), "Flight", ctx.orgId);
  if (!["DRAFT", "APPROVED", "PAUSED"].includes(flight.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `A ${flight.status.toLowerCase()} flight cannot be edited`);
  }
  const startsAt = data.startsAt ? new Date(data.startsAt) : flight.startsAt;
  const endsAt = data.endsAt ? new Date(data.endsAt) : flight.endsAt;
  validateWindow(startsAt, endsAt);
  if (data.patternId) {
    const pat = await requireOwned(await db.temporalPattern.findUnique({ where: { id: data.patternId } }), "Pattern", ctx.orgId);
    if (pat.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Pattern is archived");
  }
  return db.campaignFlight.update({
    where: { id },
    data: {
      startsAt,
      endsAt,
      timezone: data.timezone,
      budgetMinor: data.budget != null ? toMinor(data.budget) : undefined,
      cadence: (data.cadence ?? undefined) as object,
      patternId: data.patternId,
      notes: data.notes,
      audienceId: data.audienceId,
    },
  });
}

export async function approveFlight(ctx: Ctx, id: string) {
  const f = await requireOwned(await db.campaignFlight.findUnique({ where: { id } }), "Flight", ctx.orgId);
  if (f.status !== "DRAFT") throw new AppError(ErrorCodes.ILLEGAL_STATE, `Cannot approve a ${f.status.toLowerCase()} flight`);
  const updated = await db.campaignFlight.update({ where: { id }, data: { status: "APPROVED" } });
  await audit(db, ctx, "flight.approved", "CAMPAIGN", f.campaignId, { id });
  return updated;
}

export async function cancelFlight(ctx: Ctx, id: string) {
  const f = await requireOwned(await db.campaignFlight.findUnique({ where: { id } }), "Flight", ctx.orgId);
  if (["ENDED", "CANCELLED"].includes(f.status)) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Flight already ${f.status.toLowerCase()}`);
  await db.campaignFlight.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, ctx, "flight.cancelled", "CAMPAIGN", f.campaignId, { id });
}

/**
 * Materialize social slots from a cadence: for each campaign post × each
 * cadence day inside the flight window (future only, ≤60 slots), schedule a
 * ContentTarget on the channel's first connected account.
 */
export async function generateSlots(ctx: Ctx, flightId: string) {
  const flight = await requireOwned(
    await db.campaignFlight.findUnique({
      where: { id: flightId },
      include: { channel: true, campaign: { include: { contentPosts: { include: { targets: { where: { status: { not: "SKIPPED" } } } } } } } },
    }),
    "Flight",
    ctx.orgId,
  );
  if (!["APPROVED", "LIVE", "PAUSED"].includes(flight.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Approve the flight before generating slots");
  }
  // Centralization: a legacy cadence JSON is auto-adopted into a UTP pattern asset.
  let used: "pattern" | "adopted" = "pattern";
  const pattern = flight.patternId
    ? await db.temporalPattern.findUnique({ where: { id: flight.patternId } })
    : await (used = "adopted", adoptFlightCadence(ctx, flight.id, flight.orgId, flight.channel?.code ?? flightId, flight.cadence as { days?: number[]; time?: string } | null, flight.timezone));
  if (!pattern) throw new AppError(ErrorCodes.VALIDATION, "This flight has no cadence or temporal pattern configured");

  const cfg = await db.temporalConfiguration.findUnique({ where: { orgId: ctx.orgId } });
  const settings = (cfg?.settings ?? {}) as { slotCap?: number };
  const cap = Math.min(200, Math.max(1, Number(settings.slotCap ?? 60)));

  const connection = await db.socialConnection.findFirst({
    where: { orgId: ctx.orgId, connectorKey: flight.channel.connectorKey ?? "", status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });
  if (!connection) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Channel "${flight.channel.name}" has no connected account`);
  }
  const posts = flight.campaign.contentPosts.filter((p) => p.status !== "CANCELLED");
  if (!posts.length) throw new AppError(ErrorCodes.VALIDATION, "Attach content posts to the campaign first");

  // UTP materialization window: flight window, future-only
  const from = new Date(Math.max(Date.now(), flight.startsAt.getTime()));
  const occ = await expandPattern(pattern, from, flight.endsAt, { max: cap });

  let created = 0;
  for (const o of occ) {
    const slot = o.startsAt;
    if (slot.getTime() > flight.endsAt.getTime()) continue;
    for (const post of posts) {
      if (created >= cap) break;
      const instance = await db.contentPost.create({
        data: {
          orgId: ctx.orgId,
          clientId: post.clientId,
          projectId: post.projectId,
          campaignId: post.campaignId,
          title: `${post.title} · ${slot.toISOString().slice(0, 10)}`,
          body: post.body,
          linkUrl: post.linkUrl,
          hashtags: post.hashtags,
          tags: post.tags,
          source: "STUDIO",
          status: "SCHEDULED",
          createdById: ctx.userId,
          targets: { create: { connectionId: connection.id, orgId: ctx.orgId, scheduledAt: slot } },
        },
      });
      void instance;
      created++;
    }
  }
  await db.campaignFlight.update({ where: { id: flightId }, data: { slotsGenerated: { increment: created }, patternId: pattern.id } });
  await audit(db, ctx, "flight.slots", "CAMPAIGN", flight.campaignId, { flightId, created, via: used, patternId: pattern.id });
  return { created, via: used, patternId: pattern.id, cap };
}

/** Convert a legacy cadence JSON ({days:[0-6], time:"HH:MM"}) into a reusable UTP pattern asset. */
export async function adoptFlightCadence(
  ctx: Ctx,
  flightId: string,
  orgId: string,
  label: string,
  cadence: { days?: number[]; time?: string } | null | undefined,
  timezone: string,
) {
  const days = (cadence?.days ?? []).filter((d) => d >= 0 && d <= 6);
  if (!days.length) return null;
  const time = cadence?.time ?? "10:00";
  const spec = {
    freq: "WEEKLY" as const,
    interval: 1,
    weekdays: days,
    time,
    durationMinutes: 30,
  };
  const pattern = await db.temporalPattern.create({
    data: {
      orgId,
      name: `Flight cadence · ${label}`,
      type: "WINDOW",
      freq: "WEEKLY",
      spec: spec as object,
      dsl: `EVERY ${days.map((d) => ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d]).join("+")} ${time}`,
      timezone,
      createdById: ctx.userId,
      expressions: {
        create: { orgId, source: JSON.stringify(cadence), ast: spec as object, status: "OPTIMIZED", checksum: `cadence-${flightId.slice(-8)}` },
      },
    },
  });
  await db.campaignFlight.update({ where: { id: flightId }, data: { patternId: pattern.id } });
  await audit(db, ctx, "flight.cadence_adopted", undefined, flightId, { patternId: pattern.id });
  await emit(db, { type: "pattern.adopted", aggregateType: "PATTERN", aggregateId: pattern.id, orgId, payload: { flightId } });
  return pattern;
}

// ---------------------------------------------------------------------------
// Calendar view + conflicts + cron sweep
// ---------------------------------------------------------------------------

async function findOverlaps(orgId: string, channelId: string, startsAt: Date, endsAt: Date, excludeId: string | null) {
  const rows = await db.campaignFlight.findMany({
    where: {
      orgId,
      channelId,
      status: { in: ["DRAFT", "APPROVED", "LIVE", "PAUSED"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { channel: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, status: r.status, channelName: r.channel.name }));
}

export async function calendarView(ctx: Ctx, query: URLSearchParams) {
  const from = query.get("from") ? new Date(query.get("from") as string) : new Date(Date.now() - 45 * 86400_000);
  const to = query.get("to") ? new Date(query.get("to") as string) : new Date(Date.now() + 90 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new AppError(ErrorCodes.VALIDATION, "Invalid from/to range");
  }
  const [flights, targets] = await Promise.all([
    db.campaignFlight.findMany({
      where: { orgId: ctx.orgId, startsAt: { lte: to }, endsAt: { gte: from } },
      include: {
        channel: { select: { id: true, code: true, name: true, kind: true } },
        campaign: { select: { id: true, name: true, client: { select: { name: true } } } },
        audience: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    db.contentTarget.findMany({
      where: { orgId: ctx.orgId, status: { in: ["PENDING", "PUBLISHING", "PUBLISHED", "FAILED"] }, scheduledAt: { gte: from, lte: to } },
      include: {
        post: { select: { id: true, title: true, campaignId: true } },
        connection: { select: { connectorKey: true, handle: true } },
      },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);
  // conflicts: same channel overlapping windows
  const conflicts: Array<{ channelId: string; channelName: string; a: string; b: string }> = [];
  const byChannel = new Map<string, typeof flights>();
  for (const f of flights) {
    const list = byChannel.get(f.channelId) ?? [];
    list.push(f);
    byChannel.set(f.channelId, list);
  }
  for (const [channelId, list] of byChannel) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].startsAt < list[j].endsAt && list[j].startsAt < list[i].endsAt) {
          conflicts.push({ channelId, channelName: list[i].channel.name, a: list[i].id, b: list[j].id });
        }
      }
    }
  }
  return { from: from.toISOString(), to: to.toISOString(), flights, posts: targets, conflicts };
}

/** Cron sweep: date-driven flight status transitions. */
export async function sweepFlights(): Promise<{ activated: number; ended: number }> {
  const now = new Date();
  const toActivate = await db.campaignFlight.findMany({ where: { status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now } }, select: { id: true, orgId: true, campaignId: true } });
  const activated = await db.campaignFlight.updateMany({
    where: { status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now } },
    data: { status: "LIVE" },
  });
  const toEnd = await db.campaignFlight.findMany({ where: { status: { in: ["LIVE", "PAUSED"] }, endsAt: { lte: now } }, select: { id: true, orgId: true, campaignId: true } });
  const ended = await db.campaignFlight.updateMany({
    where: { status: { in: ["LIVE", "PAUSED"] }, endsAt: { lte: now } },
    data: { status: "ENDED" },
  });
  for (const f of toActivate) await emit(db, { type: "flight.activated", aggregateType: "FLIGHT", aggregateId: f.id, orgId: f.orgId, payload: { campaignId: f.campaignId } });
  for (const f of toEnd) await emit(db, { type: "flight.ended", aggregateType: "FLIGHT", aggregateId: f.id, orgId: f.orgId, payload: { campaignId: f.campaignId } });
  await db.systemSetting.upsert({
    where: { key: "cron:flights" },
    create: { key: "cron:flights", value: { at: now.toISOString() } },
    update: { value: { at: now.toISOString() } },
  });
  await logActivity(db, { action: "cron.flights_swept", meta: { activated: activated.count, ended: ended.count } });
  return { activated: activated.count, ended: ended.count };
}

// ---------------------------------------------------------------------------
// Campaign wizard — composes channels + audience + calendar in one tx
// ---------------------------------------------------------------------------

export const wizardSchema = z.object({
  name: nameish,
  clientId: z.string().max(64).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  channelIds: z.array(z.string().min(1)).min(1).max(12),
  audienceId: z.string().max(64).nullable().optional(),
  ...WINDOW,
  budget: moneySchema.nullable().optional(),
  cadence: flightSchema.shape.cadence,
  notes: longText.nullable().optional(),
});

export async function runWizard(ctx: Ctx, input: unknown) {
  const data = wizardSchema.parse(input);
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  validateWindow(startsAt, endsAt);
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  if (data.audienceId) {
    const a = await requireOwned(await db.audience.findUnique({ where: { id: data.audienceId } }), "Audience", ctx.orgId);
    if (a.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Audience is archived");
  }
  const channels: Ch[] = [];
  for (const chId of Array.from(new Set(data.channelIds))) {
    channels.push(await assertChannelUsable(db, ctx.orgId, chId));
  }
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { defaultCurrencyCode: true } });

  type Ch = Awaited<ReturnType<typeof assertChannelUsable>>;
  const campaign = await db.$transaction(async (tx) => {
    const camp = await tx.campaign.create({
      data: {
        orgId: ctx.orgId,
        clientId: data.clientId ?? null,
        projectId: data.projectId ?? null,
        mediaChannelId: channels[0].id,
        audienceId: data.audienceId ?? null,
        name: data.name,
        status: "DRAFT",
        budgetMinor: data.budget != null ? toMinor(data.budget) : null,
        currencyCode: org.defaultCurrencyCode,
        startDate: startsAt,
        endDate: endsAt,
        externalRef: null,
      },
    });
    const warnings: string[] = [];
    for (const ch of channels) {
      const overlaps = await findOverlaps(ctx.orgId, ch.id, startsAt, endsAt, null);
      if (overlaps.length) warnings.push(`${ch.name}: ${overlaps.length} overlapping flight(s)`);
      await tx.campaignFlight.create({
        data: {
          campaignId: camp.id,
          orgId: ctx.orgId,
          channelId: ch.id,
          audienceId: data.audienceId ?? null,
          startsAt,
          endsAt,
          cadence: (data.cadence ?? undefined) as object,
          notes: data.notes ?? null,
          createdById: ctx.userId,
        },
      });
    }
    await logActivity(tx, { orgId: ctx.orgId, userId: ctx.userId, action: "campaign.wizard_created", meta: { name: camp.name, channels: channels.length } });
    await emit(tx, { type: "campaign.created", aggregateType: "CAMPAIGN", aggregateId: camp.id, orgId: ctx.orgId, payload: { name: camp.name, channels: channels.length } });
    return { camp, warnings };
  });
  return campaign.camp;
}
