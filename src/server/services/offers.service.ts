import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { sha256 } from "../crypto";
import { longText, moneySchema, nameish } from "../schemas";
import { toMinor } from "../money";
import type { OfferKind, OfferStatus, OfferValueType } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

export const offerSchema = z.object({
  name: nameish,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, "3-20 chars, A-Z 0-9 dash"),
  description: longText.nullable().optional(),
  kind: z.enum(["DISCOUNT", "COUPON", "PROMOTION", "BUNDLE", "REFERRAL", "LOYALTY", "MEMBERSHIP"]).default("COUPON"),
  valueType: z.enum(["PERCENT", "AMOUNT", "FREE_ITEM", "POINTS"]).default("PERCENT"),
  percent: z.number().min(0.1).max(100).nullable().optional(),
  amount: moneySchema.nullable().optional(),
  points: z.number().int().min(1).nullable().optional(),
  minSpend: moneySchema.nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perRecipientLimit: z.number().int().min(1).max(1000).default(1),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  clientId: z.string().max(64).nullable().optional(),
  appliesToClientIds: z.array(z.string()).max(200).nullable().optional(),
  appliesToServiceItemIds: z.array(z.string()).max(200).nullable().optional(),
  terms: longText.nullable().optional(),
});

const LIFECYCLE: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "ARCHIVED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["EXPIRED", "ARCHIVED"],
  EXPIRED: ["ARCHIVED"],
  ARCHIVED: [],
};

async function requireOffer(ctx: Ctx, id: string) {
  return requireOwned(await db.offer.findUnique({ where: { id } }), "Offer", ctx.orgId);
}

export async function createOffer(ctx: Ctx, input: unknown) {
  const data = offerSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.valueType === "PERCENT" && data.percent == null) throw new AppError(ErrorCodes.VALIDATION, "PERCENT offer needs percent");
  if (data.valueType === "AMOUNT" && data.amount == null) throw new AppError(ErrorCodes.VALIDATION, "AMOUNT offer needs amount");
  if (data.valueType === "POINTS" && data.points == null) throw new AppError(ErrorCodes.VALIDATION, "POINTS offer needs points");
  const value =
    data.valueType === "PERCENT" ? Math.round(data.percent! * 100)
      : data.valueType === "AMOUNT" ? Number(toMinor(data.amount!))
        : data.valueType === "POINTS" ? data.points!
          : 1;
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const offer = await db.offer
    .create({
      data: {
        orgId: ctx.orgId,
        clientId: data.clientId ?? null,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        kind: data.kind as OfferKind,
        valueType: data.valueType as OfferValueType,
        value,
        minSpendMinor: data.minSpend != null ? toMinor(data.minSpend) : null,
        maxRedemptions: data.maxRedemptions ?? null,
        perRecipientLimit: data.perRecipientLimit,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        appliesTo: {
          clientIds: data.appliesToClientIds ?? null,
          serviceItemIds: data.appliesToServiceItemIds ?? null,
        } as object,
        terms: data.terms ?? null,
        createdById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "Offer code already exists in this workspace");
    });
  await audit(db, ctx, "offer.created", undefined, offer.id, { code: offer.code });
  return offer;
}

export async function listOffers(ctx: Ctx) {
  return db.offer.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      _count: { select: { redemptions: true, campaigns: true } },
    },
    take: 100,
  });
}

export async function getOffer(ctx: Ctx, id: string) {
  const o = await requireOffer(ctx, id);
  const [redemptions, byRecipient] = await Promise.all([
    db.offerRedemption.findMany({ where: { offerId: id, orgId: ctx.orgId }, orderBy: { at: "desc" }, take: 50 }),
    db.offerRedemption.groupBy({ by: ["recipientKey"], where: { offerId: id }, _count: true }),
  ]);
  return { offer: o, redemptions, uniqueRecipients: byRecipient.length };
}

export async function transitionOffer(ctx: Ctx, id: string, to: OfferStatus) {
  const offer = await requireOffer(ctx, id);
  if (!LIFECYCLE[offer.status].includes(to)) {
    throw new AppError(
      ErrorCodes.ILLEGAL_STATE,
      `Offer cannot go ${offer.status.toLowerCase()} → ${to.toLowerCase()} (allowed: ${LIFECYCLE[offer.status].join(", ").toLowerCase() || "none"})`,
    );
  }
  const data: Record<string, unknown> = { status: to };
  if (to === "APPROVED") { data.approvedById = ctx.userId; data.approvedAt = new Date(); }
  if (to === "PUBLISHED") data.publishedAt = new Date();
  if (to === "ACTIVE") data.activatedAt = new Date();
  if (to === "EXPIRED") data.expiredAt = new Date();
  const updated = await db.offer.update({ where: { id }, data: data as never });
  await emit(db, { type: `offer.${to.toLowerCase()}`, aggregateType: "OFFER", aggregateId: id, orgId: ctx.orgId, payload: { code: offer.code } });
  await audit(db, ctx, `offer.${to.toLowerCase()}`, undefined, id);
  return updated;
}

export async function deleteOffer(ctx: Ctx, id: string) {
  await requireOffer(ctx, id);
  const used = await db.offerRedemption.count({ where: { offerId: id } });
  if (used > 0) throw new AppError(ErrorCodes.CONFLICT, "Offer has redemptions — archive it instead");
  await db.offer.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(db, ctx, "offer.archived", undefined, id);
}

/**
 * Redemption eligibility check (pure — returns discount or throws reason).
 */
export function computeDiscount(offer: { valueType: OfferValueType; value: number }, orderSubtotalMinor: bigint): { eligible: boolean; reason: string | null; discountMinor: bigint } {
  if (orderSubtotalMinor <= 0n) return { eligible: false, reason: "empty order", discountMinor: 0n };
  if (offer.valueType === "PERCENT") {
    const d = (orderSubtotalMinor * BigInt(offer.value)) / 10_000n;
    return { eligible: true, reason: null, discountMinor: d > orderSubtotalMinor ? orderSubtotalMinor : d };
  }
  if (offer.valueType === "AMOUNT") {
    const d = BigInt(offer.value);
    return { eligible: true, reason: null, discountMinor: d > orderSubtotalMinor ? orderSubtotalMinor : d };
  }
  return { eligible: false, reason: `${offer.valueType.toLowerCase()} offers do not discount invoices`, discountMinor: 0n };
}

/**
 * Atomic, capped, eligibility-checked redemption used at invoice creation
 * (or standalone). Runs inside the caller's transaction.
 */
export async function redeemOfferIn(
  tx: typeof db | Parameters<typeof emit>[0],
  ctx: Pick<Ctx, "orgId" | "userId">,
  input: { code: string; subtotalMinor: bigint; email?: string | null; clientId?: string | null; invoiceId?: string | null; campaignId?: string | null },
): Promise<{ offerId: string; discountMinor: bigint; offerName: string }> {
  const t = tx as typeof db;
  const offer = await t.offer.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: input.code.toUpperCase() } } });
  if (!offer) throw new AppError(ErrorCodes.NOT_FOUND, "Unknown offer code");
  if (offer.status !== "ACTIVE" && offer.status !== "PUBLISHED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Offer is ${offer.status.toLowerCase()}`);
  }
  const now = new Date();
  if (offer.startsAt && offer.startsAt > now) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Offer has not started");
  if (offer.endsAt && offer.endsAt < now) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Offer has ended");
  if (offer.minSpendMinor != null && input.subtotalMinor < offer.minSpendMinor) {
    throw new AppError(ErrorCodes.VALIDATION, "Order below offer minimum spend");
  }
  const applies = (offer.appliesTo ?? {}) as { clientIds?: string[] | null };
  if (applies.clientIds?.length && (!input.clientId || !applies.clientIds.includes(input.clientId))) {
    throw new AppError(ErrorCodes.VALIDATION, "Offer not valid for this client");
  }
  const recipientKey = input.email ? sha256(`e:${input.email.toLowerCase()}`) : `client:${input.clientId ?? "anon"}`;
  if (offer.maxRedemptions != null) {
    const total = await t.offerRedemption.count({ where: { offerId: offer.id } });
    if (total >= offer.maxRedemptions) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Offer fully redeemed");
  }
  if (offer.perRecipientLimit != null) {
    const mine = await t.offerRedemption.count({ where: { offerId: offer.id, recipientKey } });
    if (mine >= offer.perRecipientLimit) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Redemption limit reached for this recipient");
  }
  const { eligible, reason, discountMinor } = computeDiscount(offer, input.subtotalMinor);
  if (!eligible) throw new AppError(ErrorCodes.VALIDATION, `Offer not applicable: ${reason}`);
  await t.offerRedemption.create({
    data: {
      offerId: offer.id,
      orgId: ctx.orgId,
      recipientKey,
      email: input.email ?? null,
      clientId: input.clientId ?? null,
      invoiceId: input.invoiceId ?? null,
      campaignId: input.campaignId ?? null,
      discountMinor,
    },
  });
  await emit(t, {
    type: "offer.redeemed",
    aggregateType: "OFFER",
    aggregateId: offer.id,
    orgId: ctx.orgId,
    payload: { code: offer.code, discountMinor: Number(discountMinor), invoiceId: input.invoiceId ?? null },
  });
  return { offerId: offer.id, discountMinor, offerName: offer.name };
}

/** Cron sweep: ACTIVE/PUBLISHED offers past end date → EXPIRED. */
export async function sweepOffers(): Promise<{ expired: number }> {
  const due = await db.offer.findMany({
    where: { status: { in: ["ACTIVE", "PUBLISHED"] }, endsAt: { lt: new Date() } },
    select: { id: true, orgId: true },
    take: 100,
  });
  for (const o of due) {
    await db.offer.update({ where: { id: o.id }, data: { status: "EXPIRED", expiredAt: new Date() } });
    await emit(db, { type: "offer.expired", aggregateType: "OFFER", aggregateId: o.id, orgId: o.orgId, payload: {} });
  }
  await db.systemSetting.upsert({
    where: { key: "cron:offers" },
    create: { key: "cron:offers", value: { at: new Date().toISOString() } },
    update: { value: { at: new Date().toISOString() } },
  });
  return { expired: due.length };
}
