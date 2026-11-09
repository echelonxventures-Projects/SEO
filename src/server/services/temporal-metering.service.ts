/**
 * TPaaS metering — records consumption for usage/consumption billing.
 * Every billable temporal act calls meter() inside its own transaction, so
 * usage and state commit atomically; billing cycles roll them up.
 */

import { z } from "zod";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { UsageMetric } from "@/generated/prisma/enums";
import { audit } from "./common";
import type { Ctx } from "./common";
import { toMinor } from "../money";
import { AppError, ErrorCodes } from "../errors";

type Db = Prisma.TransactionClient | typeof db;

export async function meter(
  client: Db,
  orgId: string,
  metric: UsageMetric,
  quantity = 1,
  subject?: { type: string; id: string },
  meta?: Record<string, unknown>,
): Promise<void> {
  await client.usageEvent.create({
    data: {
      orgId,
      metric,
      quantity,
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      meta: (meta ?? {}) as object,
    },
  });
}

export async function usageSummary(ctx: Ctx, params: URLSearchParams) {
  const days = Math.min(365, Number(params.get("days") ?? 30));
  const from = new Date(Date.now() - days * 86_400_000);
  const rows = await db.usageEvent.groupBy({
    by: ["metric"],
    where: { orgId: ctx.orgId, at: { gte: from } },
    _sum: { quantity: true },
    _count: true,
  });
  const unbilled = await db.usageEvent.aggregate({
    where: { orgId: ctx.orgId, billed: false },
    _sum: { quantity: true },
  });
  return {
    windowDays: days,
    metrics: rows.map((r) => ({ metric: r.metric, quantity: r._sum.quantity ?? 0, events: r._count })),
    unbilledQuantity: unbilled._sum.quantity ?? 0,
  };
}

export async function listUsageEvents(ctx: Ctx, params: URLSearchParams) {
  const metric = params.get("metric") ?? undefined;
  return db.usageEvent.findMany({
    where: { orgId: ctx.orgId, ...(metric ? { metric: metric as UsageMetric } : {}) },
    orderBy: { at: "desc" },
    take: 200,
  });
}

export const meteredPriceSchema = z.object({
  planId: z.string().min(1),
  metric: z.enum(["APPOINTMENT", "SCHEDULE", "TRIGGER", "EXECUTION", "RESOURCE_HOUR", "API_CALL", "WIDGET_VIEW", "MARKETPLACE_INSTALL", "ACTIVE_SEAT", "STORAGE_EVENT"]),
  includedQty: z.number().int().min(0).max(10_000_000).default(0),
  price: z.number().nonnegative().max(1_000_000).default(0),
});

export async function upsertMeteredPrice(ctx: Ctx, input: unknown) {
  // Plans and their usage prices are platform-wide: a workspace admin must
  // never be able to reprice usage for every tenant (including themselves).
  if (!ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform-admin only: metered prices apply to every workspace on the plan");
  }
  const data = meteredPriceSchema.parse(input);
  const plan = await db.plan.findUnique({ where: { id: data.planId } });
  if (!plan) throw new AppError(ErrorCodes.NOT_FOUND, "Plan not found");
  const existing = await db.planMeteredPrice.findUnique({ where: { planId_metric: { planId: data.planId, metric: data.metric } } });
  const row = existing
    ? await db.planMeteredPrice.update({ where: { id: existing.id }, data: { includedQty: data.includedQty, priceMinor: toMinor(data.price) } })
    : await db.planMeteredPrice.create({ data: { planId: data.planId, metric: data.metric, includedQty: data.includedQty, priceMinor: toMinor(data.price), currencyCode: plan.currencyCode } });
  await audit(db, ctx, "metering.price_set", undefined, row.id, { plan: plan.code, metric: data.metric });
  return row;
}

export async function listMeteredPrices(ctx: Ctx) {
  void ctx;
  return db.planMeteredPrice.findMany({ include: { plan: { select: { code: true, name: true } } }, orderBy: [{ planId: "asc" }, { metric: "asc" }] });
}

/** Roll up unbilled usage into a cycle charge (pure compute; cycle stores the minor total). */
export async function computeCycleUsage(orgId: string, planId: string, from: Date, to: Date) {
  const prices = await db.planMeteredPrice.findMany({ where: { planId } });
  const rows = await db.usageEvent.groupBy({
    by: ["metric"],
    where: { orgId, billed: false, at: { gte: from, lte: to } },
    _sum: { quantity: true },
  });
  let totalMinor = 0n;
  const lines: Array<{ metric: string; quantity: number; included: number; billable: number; unitMinor: number; amountMinor: number }> = [];
  for (const p of prices) {
    const used = Number(rows.find((r) => r.metric === p.metric)?._sum.quantity ?? 0);
    const billable = Math.max(0, used - p.includedQty);
    const amount = BigInt(billable) * p.priceMinor;
    totalMinor += amount;
    lines.push({ metric: p.metric, quantity: used, included: p.includedQty, billable, unitMinor: Number(p.priceMinor), amountMinor: Number(amount) });
  }
  return { lines, totalMinor };
}