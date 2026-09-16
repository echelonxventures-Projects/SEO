import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import type { DomainEvent } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

export const triggerSchema = z.object({
  campaignId: z.string().min(1),
  channelId: z.string().min(1),
  eventMatch: z.string().trim().min(1).max(80),
  delaySeconds: z.number().int().min(60).max(30 * 86400).default(3600),
  maxFires: z.number().int().min(1).nullable().default(null),
});

export async function createTrigger(ctx: Ctx, input: unknown) {
  const data = triggerSchema.parse(input);
  await assertWritable(ctx.orgId);
  const campaign = await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
  const channel = await db.channel.findFirst({ where: { id: data.channelId, OR: [{ orgId: ctx.orgId }, { orgId: null }] } });
  if (!channel) throw new AppError(ErrorCodes.NOT_FOUND, "Channel not found");
  if (campaign.lifecycle !== "LIVE" && campaign.lifecycle !== "APPROVED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Triggers need an approved or live campaign");
  }
  const t = await db.scheduleTrigger.create({
    data: { orgId: ctx.orgId, campaignId: campaign.id, channelId: channel.id, eventMatch: data.eventMatch, delaySeconds: data.delaySeconds, maxFires: data.maxFires, createdById: ctx.userId },
  });
  await audit(db, ctx, "trigger.created", "CAMPAIGN", campaign.id, { eventMatch: data.eventMatch });
  return t;
}

export async function listTriggers(ctx: Ctx) {
  return db.scheduleTrigger.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { campaign: { select: { name: true } }, channel: { select: { name: true } } },
  });
}

export async function toggleTrigger(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.scheduleTrigger.findUnique({ where: { id } }), "Trigger", ctx.orgId);
  await db.scheduleTrigger.update({ where: { id }, data: { active } });
}

function matches(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/**
 * Fires event-driven scheduling (called by the events dispatcher). Idempotent
 * per (trigger, event) via TriggerFire; schedules the campaign's under-queued
 * posts onto the channel's first connected account at event+delay.
 */
export async function fireTriggersFor(event: { id: string; type: string; orgId: string | null; occurredAt: Date }): Promise<number> {
  if (!event.orgId) return 0;
  const triggers = await db.scheduleTrigger.findMany({ where: { active: true, orgId: event.orgId } });
  let fired = 0;
  for (const t of triggers) {
    if (!matches(t.eventMatch, event.type)) continue;
    if (t.orgId !== event.orgId) continue;
    if (t.maxFires != null && t.firedCount >= t.maxFires) continue;
    const dup = await db.triggerFire.findUnique({ where: { triggerId_eventId: { triggerId: t.id, eventId: event.id } } });
    if (dup) continue;
    const channel = await db.channel.findUnique({ where: { id: t.channelId } });
    if (!channel) continue;
    const connection = await db.socialConnection.findFirst({
      where: { orgId: t.orgId, connectorKey: channel.connectorKey ?? "", status: "CONNECTED" },
      orderBy: { createdAt: "asc" },
    });
    if (!connection) continue;
    const posts = await db.contentPost.findMany({
      where: { campaignId: t.campaignId, status: { notIn: ["CANCELLED", "PUBLISHED"] } },
      include: { targets: { where: { connectionId: connection.id }, select: { id: true } } },
      take: 10,
    });
    const eligible = posts.filter((p) => p.targets.length === 0);
    if (!eligible.length) continue;
    const when = new Date(Math.max(event.occurredAt.getTime(), Date.now()) + t.delaySeconds * 1000);
    const targetIds: string[] = [];
    for (const p of eligible.slice(0, 3)) {
      const tgt = await db.contentTarget.create({
        data: { postId: p.id, orgId: t.orgId, connectionId: connection.id, scheduledAt: when },
      }).catch(() => null);
      if (tgt) targetIds.push(tgt.id);
    }
    if (!targetIds.length) continue;
    await db.$transaction([
      db.triggerFire.create({ data: { triggerId: t.id, eventId: event.id, targetIds } }),
      db.scheduleTrigger.update({ where: { id: t.id }, data: { firedCount: { increment: 1 }, lastFiredAt: new Date() } }),
    ]).catch(() => undefined);
    fired += targetIds.length;
  }
  return fired;
}
