import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, codeish, dateSchema, moneySchema, nameish } from "../schemas";
import { toMinor } from "../money";
import type {
  CommissionKind,
  CommissionStatus,
  FraudSignalKind,
  LoyaltyTxnKind,
  SettlementStatus,
  VoucherKind,
  VoucherStatus,
} from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Offer Commerce Engines: vouchers, loyalty, dynamic pricing, partner
// commissions/settlements and fraud signals. The Offer aggregate stays owned
// by offers.service; everything here references it read-only.
// ===========================================================================

async function requireOffer(ctx: Ctx, id: string) {
  return requireOwned(await db.offer.findUnique({ where: { id } }), "Offer", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export const voucherSchema = z.object({
  offerId: z.string().max(64).nullable().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/, "3-32 chars, A-Z 0-9 dash"),
  kind: z.enum(["CASHBACK", "VOUCHER", "REWARD", "GIFT_CARD", "STORE_CREDIT"]).default("VOUCHER"),
  value: moneySchema.default(0),
  recipientKey: z.string().trim().max(200).nullable().optional(),
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
  expiresAt: dateSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export async function issueVoucher(ctx: Ctx, input: unknown) {
  const data = voucherSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.offerId) await requireOffer(ctx, data.offerId);
  const valueMinor = toMinor(data.value);
  const row = await db.voucher
    .create({
      data: {
        orgId: ctx.orgId,
        offerId: data.offerId ?? null,
        code: data.code,
        kind: data.kind as VoucherKind,
        valueMinor,
        balanceMinor: valueMinor,
        currencyCode: data.currencyCode,
        recipientKey: data.recipientKey ?? null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        meta: data.meta as object,
        issuedById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A voucher with this code already exists");
    });
  await emit(db, { type: "voucher.issued", aggregateType: "OFFER", aggregateId: data.offerId ?? row.id, orgId: ctx.orgId, payload: { code: row.code, valueMinor: Number(valueMinor) } });
  await audit(db, ctx, "voucher.issued", undefined, row.id, { code: row.code });
  return row;
}

export async function listVouchers(ctx: Ctx, query: URLSearchParams) {
  const status = query.get("status") ?? undefined;
  const recipientKey = query.get("recipientKey") ?? undefined;
  return db.voucher.findMany({
    where: { orgId: ctx.orgId, ...(status ? { status: status as VoucherStatus } : {}), ...(recipientKey ? { recipientKey } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getVoucher(ctx: Ctx, id: string) {
  return requireOwned(await db.voucher.findUnique({ where: { id } }), "Voucher", ctx.orgId);
}

export const redeemVoucherSchema = z.object({
  amount: moneySchema.default(0),
});

/** Redeem against balance; partial redemption leaves the voucher redeemable. */
export async function redeemVoucher(ctx: Ctx, id: string, input: unknown) {
  const data = redeemVoucherSchema.parse(input);
  const voucher = await requireOwned(await db.voucher.findUnique({ where: { id } }), "Voucher", ctx.orgId);
  if (voucher.status === "VOID" || voucher.status === "EXPIRED" || voucher.status === "REDEEMED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Voucher is ${voucher.status.toLowerCase()}`);
  }
  if (voucher.expiresAt && voucher.expiresAt < new Date()) {
    await db.voucher.update({ where: { id }, data: { status: "EXPIRED" } });
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Voucher has expired");
  }
  const amount = toMinor(data.amount);
  if (amount <= 0n) throw new AppError(ErrorCodes.VALIDATION, "Redemption amount must be positive");
  if (amount > voucher.balanceMinor) throw new AppError(ErrorCodes.VALIDATION, "Redemption exceeds voucher balance");
  const balance = voucher.balanceMinor - amount;
  const status: VoucherStatus = balance === 0n ? "REDEEMED" : "PARTIALLY_REDEEMED";
  const row = await db.voucher.update({ where: { id }, data: { balanceMinor: balance, status } });
  await emit(db, { type: "voucher.redeemed", aggregateType: "OFFER", aggregateId: voucher.offerId ?? id, orgId: ctx.orgId, payload: { voucherId: id, amountMinor: Number(amount), remainingMinor: Number(balance) } });
  await audit(db, ctx, "voucher.redeemed", undefined, id, { amountMinor: Number(amount), remainingMinor: Number(balance) });
  return { voucher: row, redeemedMinor: Number(amount), remainingMinor: Number(balance) };
}

export async function voidVoucher(ctx: Ctx, id: string) {
  const voucher = await requireOwned(await db.voucher.findUnique({ where: { id } }), "Voucher", ctx.orgId);
  if (voucher.status === "REDEEMED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Cannot void a fully redeemed voucher");
  const row = await db.voucher.update({ where: { id }, data: { status: "VOID" } });
  await audit(db, ctx, "voucher.voided", undefined, id);
  return row;
}

/** Expire vouchers past their window. Called by cron. */
export async function sweepVouchers(): Promise<{ expired: number }> {
  const res = await db.voucher.updateMany({
    where: { status: { in: ["ISSUED", "PARTIALLY_REDEEMED"] }, expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return { expired: res.count };
}

// ---------------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------------

export const loyaltyAccountSchema = z.object({
  recipientKey: z.string().trim().min(1).max(200),
  clientId: z.string().max(64).nullable().optional(),
  tier: z.string().trim().max(40).default("BASE"),
});

export async function enrollLoyalty(ctx: Ctx, input: unknown) {
  const data = loyaltyAccountSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const row = await db.loyaltyAccount.upsert({
    where: { orgId_recipientKey: { orgId: ctx.orgId, recipientKey: data.recipientKey } },
    create: { orgId: ctx.orgId, clientId: data.clientId ?? null, recipientKey: data.recipientKey, tier: data.tier },
    update: { tier: data.tier },
  });
  await audit(db, ctx, "loyalty.enrolled", undefined, row.id, { recipientKey: data.recipientKey });
  return row;
}

export async function listLoyaltyAccounts(ctx: Ctx, query: URLSearchParams) {
  const tier = query.get("tier") ?? undefined;
  return db.loyaltyAccount.findMany({
    where: { orgId: ctx.orgId, ...(tier ? { tier } : {}) },
    orderBy: { lifetimePoints: "desc" },
    take: 300,
  });
}

export async function getLoyaltyAccount(ctx: Ctx, id: string) {
  const acc = await requireOwned(await db.loyaltyAccount.findUnique({ where: { id } }), "Loyalty account", ctx.orgId);
  const txns = await db.loyaltyTxn.findMany({ where: { accountId: id }, orderBy: { at: "desc" }, take: 50 });
  return { account: acc, transactions: txns };
}

export const loyaltyTxnSchema = z.object({
  kind: z.enum(["EARN", "BURN", "ADJUST", "EXPIRE"]),
  points: z.number().int().refine((n) => n !== 0, "points must be non-zero"),
  reason: z.string().trim().max(300).nullable().optional(),
  refType: z.string().trim().max(40).nullable().optional(),
  refId: z.string().max(64).nullable().optional(),
});

const TIER_THRESHOLDS: Array<{ tier: string; min: number }> = [
  { tier: "PLATINUM", min: 50_000 },
  { tier: "GOLD", min: 20_000 },
  { tier: "SILVER", min: 5_000 },
  { tier: "BASE", min: 0 },
];

/** Apply a points movement atomically and recompute tier from lifetime points. */
export async function postLoyaltyTxn(ctx: Ctx, accountId: string, input: unknown) {
  const data = loyaltyTxnSchema.parse(input);
  await assertWritable(ctx.orgId);
  const acc = await requireOwned(await db.loyaltyAccount.findUnique({ where: { id: accountId } }), "Loyalty account", ctx.orgId);
  const delta = data.kind === "BURN" || data.kind === "EXPIRE" ? -Math.abs(data.points) : Math.abs(data.points);
  if (delta < 0 && acc.points + delta < 0) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Insufficient loyalty points");
  const lifetime = delta > 0 && data.kind === "EARN" ? acc.lifetimePoints + delta : acc.lifetimePoints;
  const tier = TIER_THRESHOLDS.find((t) => lifetime >= t.min)?.tier ?? "BASE";
  const [txn, updated] = await db.$transaction([
    db.loyaltyTxn.create({ data: { accountId, orgId: ctx.orgId, kind: data.kind as LoyaltyTxnKind, points: delta, reason: data.reason ?? null, refType: data.refType ?? null, refId: data.refId ?? null } }),
    db.loyaltyAccount.update({ where: { id: accountId }, data: { points: acc.points + delta, lifetimePoints: lifetime, tier } }),
  ]);
  if (tier !== acc.tier) {
    await emit(db, { type: "loyalty.tier_changed", aggregateType: "OFFER", aggregateId: accountId, orgId: ctx.orgId, payload: { from: acc.tier, to: tier } });
  }
  await audit(db, ctx, "loyalty.txn", undefined, accountId, { kind: data.kind, points: delta, tier });
  return { transaction: txn, account: updated };
}

// ---------------------------------------------------------------------------
// Dynamic pricing
// ---------------------------------------------------------------------------

export const priceRuleSchema = z.object({
  code: codeish,
  name: nameish,
  appliesTo: z.record(z.string(), z.unknown()).default({}),
  formula: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(10_000).default(100),
});

export async function upsertPriceRule(ctx: Ctx, input: unknown, id?: string) {
  const data = priceRuleSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (id) {
    await requireOwned(await db.dynamicPriceRule.findUnique({ where: { id } }), "Price rule", ctx.orgId);
    return db.dynamicPriceRule.update({ where: { id }, data: { name: data.name, appliesTo: data.appliesTo as object, formula: data.formula as object, priority: data.priority } });
  }
  return db.dynamicPriceRule
    .create({ data: { orgId: ctx.orgId, code: data.code, name: data.name, appliesTo: data.appliesTo as object, formula: data.formula as object, priority: data.priority, createdById: ctx.userId } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A price rule with this code already exists");
    });
}

export async function listPriceRules(ctx: Ctx) {
  return db.dynamicPriceRule.findMany({ where: { orgId: ctx.orgId }, orderBy: { priority: "asc" } });
}

export async function togglePriceRule(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.dynamicPriceRule.findUnique({ where: { id } }), "Price rule", ctx.orgId);
  return db.dynamicPriceRule.update({ where: { id }, data: { active } });
}

/**
 * Evaluate active price rules over a base amount. Formula keys:
 * multiplierBps, deltaMinor, capMinor, floorMinor. First matching rule applies.
 */
export async function priceFor(ctx: Ctx, baseAmount: number, context: Record<string, unknown> = {}) {
  const rules = await db.dynamicPriceRule.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { priority: "asc" } });
  const baseMinor = toMinor(baseAmount);
  for (const r of rules) {
    const applies = (r.appliesTo ?? {}) as Record<string, unknown>;
    const match = Object.entries(applies).every(([k, v]) => context[k] === v);
    if (!match) continue;
    const formula = (r.formula ?? {}) as { multiplierBps?: number; deltaMinor?: number; capMinor?: number; floorMinor?: number };
    let minor = baseMinor;
    if (formula.multiplierBps != null) minor = (minor * BigInt(formula.multiplierBps)) / 10_000n;
    if (formula.deltaMinor != null) minor += BigInt(formula.deltaMinor);
    if (formula.floorMinor != null && minor < BigInt(formula.floorMinor)) minor = BigInt(formula.floorMinor);
    if (formula.capMinor != null && minor > BigInt(formula.capMinor)) minor = BigInt(formula.capMinor);
    await audit(db, ctx, "price.evaluated", undefined, r.id, { baseMinor: Number(baseMinor), finalMinor: Number(minor) });
    return { ruleId: r.id, code: r.code, baseMinor: Number(baseMinor), finalMinor: Number(minor) };
  }
  return { ruleId: null, code: null, baseMinor: Number(baseMinor), finalMinor: Number(baseMinor) };
}

// ---------------------------------------------------------------------------
// Partner commissions
// ---------------------------------------------------------------------------

export const commissionRuleSchema = z.object({
  partnerKey: z.string().trim().min(1).max(120),
  kind: z.enum(["PERCENT", "FIXED", "HYBRID"]).default("PERCENT"),
  valueBps: bpsSchema.default(0),
  value: moneySchema.default(0),
});

export async function upsertCommissionRule(ctx: Ctx, input: unknown) {
  const data = commissionRuleSchema.parse(input);
  await assertWritable(ctx.orgId);
  return db.commissionRule.upsert({
    where: { orgId_partnerKey: { orgId: ctx.orgId, partnerKey: data.partnerKey } },
    create: { orgId: ctx.orgId, partnerKey: data.partnerKey, kind: data.kind as CommissionKind, valueBps: data.valueBps, valueMinor: toMinor(data.value) },
    update: { kind: data.kind as CommissionKind, valueBps: data.valueBps, valueMinor: toMinor(data.value) },
  });
}

export async function listCommissionRules(ctx: Ctx) {
  return db.commissionRule.findMany({ where: { orgId: ctx.orgId }, orderBy: { partnerKey: "asc" } });
}

export const commissionEventSchema = z.object({
  partnerKey: z.string().trim().min(1).max(120),
  invoiceId: z.string().max(64).nullable().optional(),
  amount: moneySchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
});

/** Accrue commission for an event using the partner's rule (PERCENT/HYBRID/FIXED). */
export async function accrueCommission(ctx: Ctx, input: unknown) {
  const data = commissionEventSchema.parse(input);
  await assertWritable(ctx.orgId);
  const rule = await db.commissionRule.findUnique({ where: { orgId_partnerKey: { orgId: ctx.orgId, partnerKey: data.partnerKey } } });
  if (!rule || !rule.active) throw new AppError(ErrorCodes.VALIDATION, "No active commission rule for this partner");
  const base = toMinor(data.amount);
  let commission = 0n;
  if (rule.kind === "PERCENT" || rule.kind === "HYBRID") commission += (base * BigInt(rule.valueBps)) / 10_000n;
  if (rule.kind === "FIXED" || rule.kind === "HYBRID") commission += rule.valueMinor;
  const row = await db.commissionEvent.create({
    data: { orgId: ctx.orgId, ruleId: rule.id, partnerKey: data.partnerKey, invoiceId: data.invoiceId ?? null, amountMinor: commission, currencyCode: data.currencyCode, status: "ACCRUED" },
  });
  await emit(db, { type: "commission.accrued", aggregateType: "OFFER", aggregateId: row.id, orgId: ctx.orgId, payload: { partnerKey: data.partnerKey, amountMinor: Number(commission) } });
  await audit(db, ctx, "commission.accrued", undefined, row.id, { partnerKey: data.partnerKey, amountMinor: Number(commission) });
  return row;
}

export async function listCommissionEvents(ctx: Ctx, query: URLSearchParams) {
  const partnerKey = query.get("partnerKey") ?? undefined;
  const status = query.get("status") ?? undefined;
  return db.commissionEvent.findMany({
    where: { orgId: ctx.orgId, ...(partnerKey ? { partnerKey } : {}), ...(status ? { status: status as CommissionStatus } : {}) },
    orderBy: { at: "desc" },
    take: 300,
  });
}

export async function approveCommissionEvent(ctx: Ctx, id: string) {
  const row = await requireOwned(await db.commissionEvent.findUnique({ where: { id } }), "Commission event", ctx.orgId);
  if (row.status !== "ACCRUED") throw new AppError(ErrorCodes.ILLEGAL_STATE, `Commission event is ${row.status.toLowerCase()}`);
  const updated = await db.commissionEvent.update({ where: { id }, data: { status: "APPROVED" } });
  await audit(db, ctx, "commission.approved", undefined, id);
  return updated;
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export const settlementSchema = z.object({
  partnerKey: z.string().trim().min(1).max(120),
  periodStart: dateSchema,
  periodEnd: dateSchema,
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
});

/** Build a settlement from APPROVED commission events inside the period. */
export async function createSettlement(ctx: Ctx, input: unknown) {
  const data = settlementSchema.parse(input);
  await assertWritable(ctx.orgId);
  const start = new Date(data.periodStart);
  const end = new Date(data.periodEnd);
  if (end <= start) throw new AppError(ErrorCodes.VALIDATION, "Period end must be after start");
  const events = await db.commissionEvent.findMany({
    where: { orgId: ctx.orgId, partnerKey: data.partnerKey, status: "APPROVED", at: { gte: start, lte: end } },
  });
  const total = events.reduce((a, e) => a + e.amountMinor, 0n);
  const row = await db.$transaction(async (tx) => {
    const settlement = await tx.settlement.create({
      data: { orgId: ctx.orgId, partnerKey: data.partnerKey, periodStart: start, periodEnd: end, amountMinor: total, currencyCode: data.currencyCode, status: "OPEN" },
    });
    await tx.commissionEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { status: "PAID" } });
    await audit(tx, ctx, "settlement.created", undefined, settlement.id, { partnerKey: data.partnerKey, amountMinor: Number(total) });
    return settlement;
  });
  return { settlement: row, eventCount: events.length, amountMinor: Number(total) };
}

export async function listSettlements(ctx: Ctx, query: URLSearchParams) {
  const partnerKey = query.get("partnerKey") ?? undefined;
  return db.settlement.findMany({ where: { orgId: ctx.orgId, ...(partnerKey ? { partnerKey } : {}) }, orderBy: { periodEnd: "desc" }, take: 200 });
}

export async function transitionSettlement(ctx: Ctx, id: string, to: SettlementStatus, reference?: string) {
  const s = await requireOwned(await db.settlement.findUnique({ where: { id } }), "Settlement", ctx.orgId);
  const flow: Record<SettlementStatus, SettlementStatus[]> = {
    OPEN: ["PROCESSING", "PAID", "FAILED"],
    PROCESSING: ["PAID", "FAILED"],
    PAID: [],
    FAILED: ["OPEN"],
  };
  if (!flow[s.status].includes(to)) throw new AppError(ErrorCodes.ILLEGAL_STATE, `Settlement cannot go ${s.status.toLowerCase()} → ${to.toLowerCase()}`);
  const row = await db.settlement.update({ where: { id }, data: { status: to, ...(to === "PAID" ? { paidAt: new Date(), reference: reference ?? s.reference } : {}) } });
  await audit(db, ctx, `settlement.${to.toLowerCase()}`, undefined, id);
  return row;
}

// ---------------------------------------------------------------------------
// Fraud signals
// ---------------------------------------------------------------------------

const FRAUD_KINDS = ["VELOCITY", "DEVICE_REUSE", "IP_CLUSTER", "GEO_MISMATCH", "REPEATED_CANCELLATION", "IMPOSSIBLE_TRAVEL", "CUSTOM"] as const;

export const fraudSignalSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(FRAUD_KINDS),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

export async function recordFraudSignal(ctx: Ctx, input: unknown) {
  const data = fraudSignalSchema.parse(input);
  const row = await db.fraudSignal.create({
    data: { orgId: ctx.orgId, subjectKey: data.subjectKey, kind: data.kind as FraudSignalKind, severity: data.severity, evidence: data.evidence as object },
  });
  await emit(db, { type: "fraud.detected", aggregateType: "OFFER", aggregateId: row.id, orgId: ctx.orgId, payload: { kind: data.kind, severity: data.severity } });
  await audit(db, ctx, "fraud.detected", undefined, row.id, { kind: data.kind, severity: data.severity });
  return row;
}

export async function listFraudSignals(ctx: Ctx, query: URLSearchParams) {
  const resolved = query.get("resolved");
  const subjectKey = query.get("subjectKey") ?? undefined;
  return db.fraudSignal.findMany({
    where: { orgId: ctx.orgId, ...(resolved !== null ? { resolved: resolved === "true" } : {}), ...(subjectKey ? { subjectKey } : {}) },
    orderBy: { at: "desc" },
    take: 300,
  });
}

export async function resolveFraudSignal(ctx: Ctx, id: string) {
  await requireOwned(await db.fraudSignal.findUnique({ where: { id } }), "Fraud signal", ctx.orgId);
  const row = await db.fraudSignal.update({ where: { id }, data: { resolved: true } });
  await audit(db, ctx, "fraud.resolved", undefined, id);
  return row;
}

/** Deterministic heuristic fraud scan: redemption velocity per subject. */
export async function scanRedemptionVelocity(ctx: Ctx, windowMinutes = 60, threshold = 5) {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const bySubject = await db.offerRedemption.groupBy({
    by: ["recipientKey"],
    where: { orgId: ctx.orgId, at: { gte: since } },
    _count: true,
  });
  const flagged = [];
  for (const g of bySubject) {
    if (g.recipientKey && g._count >= threshold) {
      flagged.push(await recordFraudSignal(ctx, { subjectKey: g.recipientKey, kind: "VELOCITY", severity: "HIGH", evidence: { redemptions: g._count, windowMinutes } }));
    }
  }
  return { scanned: bySubject.length, flagged: flagged.length };
}

// ---------------------------------------------------------------------------
// Commerce rollup
// ---------------------------------------------------------------------------

export async function commerceSummary(ctx: Ctx) {
  const [vouchersByStatus, loyalty, commissions, settlements, fraud] = await Promise.all([
    db.voucher.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: true, _sum: { balanceMinor: true } }),
    db.loyaltyAccount.aggregate({ where: { orgId: ctx.orgId }, _sum: { points: true, lifetimePoints: true }, _count: true }),
    db.commissionEvent.groupBy({ by: ["status"], where: { orgId: ctx.orgId }, _count: true, _sum: { amountMinor: true } }),
    db.settlement.aggregate({ where: { orgId: ctx.orgId }, _sum: { amountMinor: true }, _count: true }),
    db.fraudSignal.count({ where: { orgId: ctx.orgId, resolved: false } }),
  ]);
  return {
    vouchers: vouchersByStatus.map((v) => ({ status: v.status, count: v._count, outstandingMinor: Number(v._sum.balanceMinor ?? 0n) })),
    loyalty: { accounts: loyalty._count, points: loyalty._sum.points ?? 0, lifetimePoints: loyalty._sum.lifetimePoints ?? 0 },
    commissions: commissions.map((c) => ({ status: c.status, count: c._count, amountMinor: Number(c._sum.amountMinor ?? 0n) })),
    settlements: { count: settlements._count, amountMinor: Number(settlements._sum.amountMinor ?? 0n) },
    openFraudSignals: fraud,
  };
}
