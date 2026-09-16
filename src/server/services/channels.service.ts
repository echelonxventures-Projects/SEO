import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, urlish } from "../schemas";
import type { ChannelCostModel, ChannelKind, Prisma } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

export const channelSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/),
  name: nameish,
  kind: z.enum(["SEARCH", "SOCIAL", "DISPLAY", "VIDEO", "EMAIL", "WHATSAPP", "SMS", "AFFILIATE", "ORGANIC", "DIRECT_MAIL", "MARKETPLACE"]),
  description: z.string().trim().max(500).nullable().optional(),
  costModel: z.enum(["CPC", "CPM", "CPA", "FLAT", "FREE"]).default("CPC"),
  capabilities: z.array(z.string().trim().max(40)).max(10).default(["audience", "scheduling", "creative", "tracking"]),
  connectorKey: z.string().trim().toLowerCase().max(40).nullable().optional(),
  utmMedium: z.string().trim().max(40).default("paid"),
  budgetCap: z.number().nonnegative().nullable().optional(),
});

/** Org channels override/extend the platform default catalog (same precedence rule everywhere). */
export async function listChannels(ctx: Ctx) {
  const [rows, connections] = await Promise.all([
    db.channel.findMany({ where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.socialConnection.findMany({ where: { orgId: ctx.orgId, status: "CONNECTED" }, select: { connectorKey: true } }),
  ]);
  const connected = new Set(connections.map((c) => c.connectorKey));
  const merged = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    const prev = merged.get(r.code);
    if (!prev || (r.orgId !== null && prev.orgId === null)) merged.set(r.code, r);
  }
  return [...merged.values()].map((c) => {
    const needsSocial = c.kind === "SOCIAL" || c.kind === "VIDEO";
    const ready = !c.requiresConnection || (c.connectorKey != null && connected.has(c.connectorKey)) || (!needsSocial);
    return { ...c, budgetCapMinor: c.budgetCapMinor != null ? Number(c.budgetCapMinor) : null, ready };
  });
}

export async function createChannel(ctx: Ctx, input: unknown) {
  const data = channelSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.kind === "SOCIAL" && data.connectorKey) {
    const { resolveConnector } = await import("../connectors/engine");
    if (!(await resolveConnector(data.connectorKey, ctx.orgId))) {
      throw new AppError(ErrorCodes.VALIDATION, `Unknown connector "${data.connectorKey}"`);
    }
  }
  const ch = await db.channel
    .create({
      data: {
        orgId: ctx.orgId,
        code: data.code,
        name: data.name,
        kind: data.kind as ChannelKind,
        description: data.description ?? null,
        costModel: data.costModel as ChannelCostModel,
        capabilities: data.capabilities,
        connectorKey: data.connectorKey ?? null,
        requiresConnection: data.kind === "SOCIAL" || data.kind === "VIDEO" || data.kind === "EMAIL",
        utmMedium: data.utmMedium,
        budgetCapMinor: data.budgetCap != null ? BigInt(Math.round(data.budgetCap * 100)) : null,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "Channel code already used");
    });
  await audit(db, ctx, "channel.created", undefined, ch.id, { code: ch.code });
  return ch;
}

export async function toggleChannel(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.channel.findUnique({ where: { id } }), "Channel", ctx.orgId);
  await db.channel.update({ where: { id }, data: { active } });
  await audit(db, ctx, active ? "channel.enabled" : "channel.disabled", undefined, id);
}

/** Channels that are currently publishable (connector connected / no connector needed). */
export async function assertChannelUsable(tx: Prisma.TransactionClient, orgId: string, channelId: string) {
  const ch = await tx.channel.findFirst({ where: { id: channelId, OR: [{ orgId }, { orgId: null }] } });
  if (!ch || !ch.active) throw new AppError(ErrorCodes.NOT_FOUND, "Channel not available");
  if (ch.requiresConnection) {
    const n = await tx.socialConnection.count({ where: { orgId, connectorKey: ch.connectorKey ?? "", status: "CONNECTED" } });
    if (n === 0) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Channel "${ch.name}" needs a connected ${ch.connectorKey ?? "media"} account first`);
  }
  return ch;
}
