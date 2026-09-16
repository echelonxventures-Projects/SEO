import { z } from "zod";
import { db } from "../db";
import { getEnv } from "../env";
import { AppError, ErrorCodes } from "../errors";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { nextDocumentNumber } from "../numbering";
import { minorToNumber } from "../money";
import { signToken, verifyToken } from "../tokens";
import { logActivity } from "../audit";
import { Prisma } from "@/generated/prisma/client";
import type { Plan } from "@/generated/prisma/client";
import type { GatewayConfig } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { audit, requireOwned } from "./common";
import { getGatewayProvider } from "../gateways/registry";
import type { GatewayProvider, VerifiedWebhook } from "../gateways/types";
import { settleInvoicePayment } from "./ledger";

const CREDIT_DAYS = 7;

function addInterval(date: Date, interval: "MONTH" | "QUARTER" | "YEAR"): Date {
  const d = new Date(date);
  if (interval === "MONTH") d.setUTCMonth(d.getUTCMonth() + 1);
  if (interval === "QUARTER") d.setUTCMonth(d.getUTCMonth() + 3);
  if (interval === "YEAR") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

// ---------------------------------------------------------------------------
// Gateway configuration (envelope-encrypted credentials at rest)
// ---------------------------------------------------------------------------

export const gatewayUpsertSchema = z.object({
  providerCode: z.enum(["razorpay", "stripe", "mock"]),
  scope: z.enum(["PLATFORM", "ORGANIZATION"]),
  mode: z.enum(["SANDBOX", "LIVE"]),
  label: z.string().trim().min(2).max(80),
  keyId: z.string().trim().min(3).max(200),
  keySecret: z.string().trim().min(3).max(200),
  webhookSecret: z.string().trim().min(3).max(200).nullable().default(null),
});

function credentialAad(scope: string, orgId: string | null, providerCode: string): string {
  return `gateway:${scope}:${scope === "ORGANIZATION" ? orgId : "platform"}:${providerCode}`;
}

function webhookAad(scope: string, orgId: string | null, providerCode: string): string {
  return `${credentialAad(scope, orgId, providerCode)}:wh`;
}

type CredentialShape = { keyId: string; keySecret: string };

export function gatewayCredential(cfg: GatewayConfig): CredentialShape {
  return JSON.parse(
    decryptSecret(cfg.credentialEnc, credentialAad(cfg.scope, cfg.orgId, cfg.providerCode)),
  ) as CredentialShape;
}

export function gatewayWebhookSecret(cfg: GatewayConfig): string | null {
  if (!cfg.webhookSecretEnc) return null;
  return decryptSecret(cfg.webhookSecretEnc, webhookAad(cfg.scope, cfg.orgId, cfg.providerCode));
}

export async function listGatewayConfigs(ctx: Ctx, includePlatform: boolean) {
  return db.gatewayConfig.findMany({
    where: {
      OR: [
        { scope: "ORGANIZATION", orgId: ctx.orgId },
        ...(includePlatform ? [{ scope: "PLATFORM" as const }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      providerCode: true,
      scope: true,
      mode: true,
      label: true,
      active: true,
      publicMeta: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function upsertGatewayConfig(ctx: Ctx, input: unknown) {
  const data = gatewayUpsertSchema.parse(input);
  if (data.scope === "PLATFORM" && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Only platform operators can configure PLATFORM gateways");
  }
  const credentialEnc = encryptSecret(
    JSON.stringify({ keyId: data.keyId, keySecret: data.keySecret } satisfies CredentialShape),
    credentialAad(data.scope, ctx.orgId, data.providerCode),
  );
  const webhookSecretEnc = data.webhookSecret
    ? encryptSecret(data.webhookSecret, webhookAad(data.scope, ctx.orgId, data.providerCode))
    : undefined;

  const existing = await db.gatewayConfig.findFirst({
    where: {
      providerCode: data.providerCode,
      scope: data.scope,
      orgId: data.scope === "ORGANIZATION" ? ctx.orgId : null,
    },
  });
  if (existing) {
    const updated = await db.gatewayConfig.update({
      where: { id: existing.id },
      data: {
        mode: data.mode,
        label: data.label,
        credentialEnc: credentialEnc as unknown as Prisma.InputJsonValue,
        ...(webhookSecretEnc
          ? { webhookSecretEnc: webhookSecretEnc as unknown as Prisma.InputJsonValue }
          : { webhookSecretEnc: Prisma.DbNull }),
        publicMeta: { keyId: data.keyId } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await audit(db, ctx, "gateway.updated", undefined, updated.id, {
      provider: data.providerCode,
      mode: data.mode,
    });
    return updated;
  }
  const created = await db.gatewayConfig.create({
    data: {
      providerCode: data.providerCode,
      scope: data.scope,
      orgId: data.scope === "ORGANIZATION" ? ctx.orgId : null,
      mode: data.mode,
      label: data.label,
      credentialEnc: credentialEnc as unknown as Prisma.InputJsonValue,
      ...(webhookSecretEnc
        ? { webhookSecretEnc: webhookSecretEnc as unknown as Prisma.InputJsonValue }
        : {}),
      publicMeta: { keyId: data.keyId } as Prisma.InputJsonValue,
      active: false,
    },
    select: { id: true },
  });
  await audit(db, ctx, "gateway.created", undefined, created.id, { provider: data.providerCode });
  return created;
}

export async function activateGatewayConfig(ctx: Ctx, id: string) {
  const cfg = await db.gatewayConfig.findUnique({ where: { id } });
  if (!cfg) throw new AppError(ErrorCodes.NOT_FOUND, "Gateway not found");
  if (cfg.scope === "ORGANIZATION" && cfg.orgId !== ctx.orgId) {
    throw new AppError(ErrorCodes.ORG_MISMATCH, "Gateway belongs to another workspace");
  }
  if (cfg.scope === "PLATFORM" && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform gateways require platform access");
  }
  await db.$transaction([
    db.gatewayConfig.updateMany({
      where: { scope: cfg.scope, orgId: cfg.orgId, active: true },
      data: { active: false },
    }),
    db.gatewayConfig.update({ where: { id }, data: { active: true } }),
  ]);
  await audit(db, ctx, "gateway.activated", undefined, id, { provider: cfg.providerCode });
}

export async function deactivateGatewayConfig(ctx: Ctx, id: string) {
  const cfg = await requireOwned(
    await db.gatewayConfig.findUnique({ where: { id } }),
    "Gateway",
    ctx.orgId,
  );
  if (cfg.scope === "PLATFORM" && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform gateways require platform access");
  }
  await db.gatewayConfig.update({ where: { id }, data: { active: false } });
  await audit(db, ctx, "gateway.deactivated", undefined, id);
}

export async function deleteGatewayConfig(ctx: Ctx, id: string) {
  const cfg = await requireOwned(
    await db.gatewayConfig.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } }),
    "Gateway",
    ctx.orgId,
  );
  if (cfg.scope === "PLATFORM" && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform gateways require platform access");
  }
  if (cfg._count.payments > 0) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      "Gateway has recorded payments; deactivate it instead of deleting (financial trail must be preserved)",
    );
  }
  await db.gatewayConfig.delete({ where: { id } });
  await audit(db, ctx, "gateway.deleted", undefined, id);
}

async function resolveGateway(scope: "PLATFORM" | "ORGANIZATION", orgId: string | null): Promise<GatewayConfig> {
  const cfg = await db.gatewayConfig.findFirst({
    where: { scope, orgId, active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!cfg) {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      scope === "PLATFORM"
        ? "No active platform payment gateway is configured"
        : "No active payment gateway for this workspace. Add one under Settings → Payments.",
    );
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Plans & subscriptions
// ---------------------------------------------------------------------------

export async function listPublishedPlans() {
  return db.plan.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sortOrder: "asc" },
    include: { features: true, currency: true },
  });
}

async function billingActorUserId(tx: Prisma.TransactionClient): Promise<string> {
  const admin = await tx.user.findFirst({
    where: { isPlatformAdmin: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!admin) {
    throw new AppError(ErrorCodes.INTERNAL, "No platform operator exists to issue billing documents");
  }
  return admin.id;
}

async function createTenantInvoice(
  tx: Prisma.TransactionClient,
  orgId: string,
  subscriptionId: string,
  plan: Pick<Plan, "name" | "code" | "priceMinor" | "currencyCode" | "interval">,
  seats: number,
  periodStart: Date,
  periodEnd: Date,
) {
  const number = await nextDocumentNumber(tx, orgId, "INVOICE");
  const total = plan.priceMinor * BigInt(seats);
  return tx.invoice.create({
    data: {
      orgId,
      tenantId: orgId,
      partyKind: "TENANT",
      subscriptionId,
      number,
      status: "ISSUED",
      currencyCode: plan.currencyCode,
      issueDate: periodStart,
      dueDate: new Date(periodStart.getTime() + CREDIT_DAYS * 86400_000),
      subtotalMinor: total,
      taxMinor: 0n,
      totalMinor: total,
      taxBreakdown: [] as Prisma.InputJsonValue,
      notes: `OmniMark ${plan.name} — ${seats} seat(s) — period ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
      createdByUserId: await billingActorUserId(tx),
      lines: {
        create: [
          {
            description: `OmniMark subscription — ${plan.name} (${plan.interval.toLowerCase()} cycle)`,
            qtyHundredths: seats * 100,
            unitPriceMinor: plan.priceMinor,
            taxBps: 0,
            lineTotalMinor: total,
            sourceType: "SUBSCRIPTION",
            sortOrder: 0,
          },
        ],
      },
    },
  });
}

export const subscribeSchema = z.object({
  planCode: z.string().min(1).max(64),
  seats: z.number().int().min(1).max(10_000).optional(),
});

export async function subscribe(ctx: Ctx, input: unknown) {
  const { planCode, seats } = subscribeSchema.parse(input);
  const plan = await db.plan.findFirst({ where: { code: planCode, status: "PUBLISHED" } });
  if (!plan) throw new AppError(ErrorCodes.NOT_FOUND, "Plan not found or not published");

  const memberCount = await db.membership.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } });
  const wantedSeats = seats ?? Math.max(memberCount, 1);
  if (plan.maxSeats > 0 && wantedSeats > plan.maxSeats) {
    throw new AppError(ErrorCodes.PLAN_LIMIT, `Plan ${plan.name} allows at most ${plan.maxSeats} seats`);
  }

  const current = await db.subscription.findFirst({
    where: { orgId: ctx.orgId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (current && current.planId === plan.id && ["TRIALING", "ACTIVE"].includes(current.status)) {
    throw new AppError(ErrorCodes.CONFLICT, "You are already subscribed to this plan");
  }
  const isFirstEver = !(await db.subscription.findFirst({ where: { orgId: ctx.orgId } }));
  const withTrial = isFirstEver && plan.trialDays > 0;
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    if (current) {
      // Supersede the previous subscription at once when switching plans.
      await tx.subscription.update({
        where: { id: current.id },
        data: { status: "CANCELLED", cancelledAt: now, cancelAtPeriodEnd: false },
      });
    }
    const periodEnd = withTrial
      ? new Date(now.getTime() + plan.trialDays * 86400_000)
      : addInterval(now, plan.interval);
    const sub = await tx.subscription.create({
      data: {
        orgId: ctx.orgId,
        planId: plan.id,
        seats: wantedSeats,
        status: withTrial ? "TRIALING" : "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: withTrial ? periodEnd : null,
      },
    });
    if (!withTrial) {
      const cycle = await tx.billingCycle.create({
        data: { subscriptionId: sub.id, periodStart: now, periodEnd, status: "PENDING" },
      });
      const inv = await createTenantInvoice(tx, ctx.orgId, sub.id, plan, wantedSeats, now, periodEnd);
      await tx.billingCycle.update({ where: { id: cycle.id }, data: { status: "INVOICED", invoiceId: inv.id } });
    }
    await audit(tx, ctx, "subscription.started", "SUBSCRIPTION", sub.id, {
      plan: plan.code,
      seats: wantedSeats,
      trial: withTrial,
    });
    return sub;
  });
  return { subscriptionId: created.id, trialing: withTrial };
}

export const cancelSchema = z.object({ immediate: z.boolean().default(false) });

export async function cancelSubscription(ctx: Ctx, input: unknown) {
  const { immediate } = cancelSchema.parse(input ?? {});
  const sub = await db.subscription.findFirst({
    where: { orgId: ctx.orgId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new AppError(ErrorCodes.NOT_FOUND, "No active subscription");
  await db.subscription.update({
    where: { id: sub.id },
    data: immediate
      ? { status: "CANCELLED", cancelledAt: new Date() }
      : { cancelAtPeriodEnd: true },
  });
  await audit(db, ctx, "subscription.cancelled", "SUBSCRIPTION", sub.id, { immediate });
}

export async function resumeSubscription(ctx: Ctx) {
  const sub = await db.subscription.findFirst({
    where: { orgId: ctx.orgId, cancelAtPeriodEnd: true, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "GRACE_PERIOD"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new AppError(ErrorCodes.NOT_FOUND, "There is nothing to resume");
  await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
  await audit(db, ctx, "subscription.resumed", "SUBSCRIPTION", sub.id);
}

export async function getBillingState(ctx: Ctx) {
  const sub = await db.subscription.findFirst({
    where: { orgId: ctx.orgId },
    include: {
      plan: { include: { features: true, currency: true } },
      invoices: {
        where: { status: { not: "VOID" } },
        orderBy: { issueDate: "desc" },
        take: 12,
        select: {
          id: true,
          number: true,
          status: true,
          totalMinor: true,
          paidMinor: true,
          dueDate: true,
          issueDate: true,
          currencyCode: true,
        },
      },
      cycles: { orderBy: { periodStart: "desc" }, take: 6 },
    },
    orderBy: { createdAt: "desc" },
  });
  const [seats, clients, projects, keywords] = await Promise.all([
    db.membership.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    db.client.count({ where: { orgId: ctx.orgId } }),
    db.project.count({ where: { orgId: ctx.orgId } }),
    db.keyword.count({ where: { orgId: ctx.orgId } }),
  ]);
  return {
    subscription: sub,
    usage: { seats, clients, projects, keywords },
  };
}

// ---------------------------------------------------------------------------
// Checkout (tenant subscription invoices + client invoices)
// ---------------------------------------------------------------------------

async function startCheckout(
  ctx: Ctx,
  invoiceId: string,
  scope: "PLATFORM" | "ORGANIZATION",
) {
  const invoice = await requireOwned(
    await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: { select: { name: true, billingEmail: true } } },
    }),
    "Invoice",
    ctx.orgId,
  );
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  if (["DRAFT", "PAID", "VOID"].includes(invoice.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `A ${invoice.status} invoice cannot be collected online`);
  }
  const cfg = await resolveGateway(scope, scope === "ORGANIZATION" ? ctx.orgId : null);
  const provider = getGatewayProvider(cfg.providerCode);
  const credential = gatewayCredential(cfg);
  const token = signToken("invoice_checkout", invoice.id, 30 * 86400);
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  const result = await provider.createCheckout(cfg, credential, {
    invoiceId: invoice.id,
    amountMinor: outstanding,
    currency: invoice.currencyCode,
    payerEmail: invoice.client?.billingEmail ?? org.email,
    payerName: invoice.client?.name ?? org.name,
    description: `${invoice.partyKind === "TENANT" ? "OmniMark subscription" : "Invoice"} ${invoice.number}`,
    successUrl: `${getEnv().APP_URL}/pay/${encodeURIComponent(token)}?status=success`,
    cancelUrl: `${getEnv().APP_URL}/pay/${encodeURIComponent(token)}?status=cancelled`,
  });
  await db.invoice.update({
    where: { id: invoice.id },
    data: { checkoutToken: token, gatewayCheckoutRef: result.providerRef },
  });
  await audit(db, ctx, "invoice.checkout_started", "INVOICE", invoice.id, {
    gateway: cfg.providerCode,
    ref: result.providerRef,
  });
  return {
    payUrl: result.url ?? `${getEnv().APP_URL}/pay/${encodeURIComponent(token)}`,
    mode: result.mode,
    provider: cfg.providerCode,
  };
}

export async function checkoutTenantInvoice(ctx: Ctx, invoiceId: string) {
  const invoice = await requireOwned(await db.invoice.findUnique({ where: { id: invoiceId } }), "Invoice", ctx.orgId);
  if (invoice.partyKind !== "TENANT") {
    throw new AppError(ErrorCodes.VALIDATION, "That is not a platform billing invoice");
  }
  return startCheckout(ctx, invoiceId, "PLATFORM");
}

export async function checkoutClientInvoice(ctx: Ctx, invoiceId: string) {
  const invoice = await requireOwned(await db.invoice.findUnique({ where: { id: invoiceId } }), "Invoice", ctx.orgId);
  if (invoice.partyKind !== "CLIENT") {
    throw new AppError(ErrorCodes.VALIDATION, "That is not a client invoice");
  }
  return startCheckout(ctx, invoiceId, "ORGANIZATION");
}

/** Sandbox/mock settlement by checkout token — a capability endpoint (no login). */
export async function settleByCheckoutToken(token: string, ip: string | null) {
  const decoded = verifyToken("invoice_checkout", token);
  const invoice = await db.invoice.findUnique({
    where: { id: decoded.s },
    include: {
      subscription: { include: { cycles: { orderBy: { periodStart: "desc" } } } },
    },
  });
  if (!invoice || invoice.checkoutToken !== token) {
    throw new AppError(ErrorCodes.FORBIDDEN, "This checkout session is no longer valid");
  }
  if (invoice.status === "PAID") {
    return { alreadyPaid: true, invoiceId: invoice.id };
  }
  const cfg = await resolveGateway(
    invoice.partyKind === "TENANT" ? "PLATFORM" : "ORGANIZATION",
    invoice.partyKind === "TENANT" ? null : invoice.orgId,
  );
  if (cfg.providerCode !== "mock" || cfg.mode !== "SANDBOX") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only the sandbox gateway settles instantly");
  }
  const outstanding = invoice.totalMinor - invoice.paidMinor;
  const gatewayPaymentRef = invoice.gatewayCheckoutRef ?? `mock_${randomToken(8)}`;
  await db.$transaction(async (tx) => {
    await settleInvoicePayment(tx, {
      orgId: invoice.orgId,
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      amountMinor: outstanding,
      currencyCode: invoice.currencyCode,
      method: "GATEWAY",
      paidAt: new Date(),
      reference: "sandbox settlement",
      gatewayConfigId: cfg.id,
      gatewayPaymentRef,
      recordedByUserId: await billingActorUserId(tx),
    });
    if (invoice.partyKind === "TENANT" && invoice.subscriptionId) {
      const openCycle = invoice.subscription?.cycles.find((c) => c.invoiceId === invoice.id);
      if (openCycle) {
        await tx.billingCycle.update({ where: { id: openCycle.id }, data: { status: "PAID" } });
      }
      if (invoice.subscription && ["PAST_DUE", "GRACE_PERIOD"].includes(invoice.subscription.status)) {
        await tx.subscription.update({ where: { id: invoice.subscription.id }, data: { status: "ACTIVE" } });
      }
    }
    await logActivity(tx, {
      orgId: invoice.orgId,
      userId: null,
      action: "payment.sandbox_settled",
      entityType: "INVOICE",
      entityId: invoice.id,
      meta: { amountMinor: minorToNumber(outstanding) },
      ip,
    });
  });
  return { alreadyPaid: false, invoiceId: invoice.id };
}

// ---------------------------------------------------------------------------
// Webhook processing
// ---------------------------------------------------------------------------

type Capture = {
  matchByProviderRef?: string;
  matchByInvoiceId?: string;
  paymentRef: string;
  amountMinor: bigint;
  currency: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Normalizes the money-moving webhook shapes for each supported provider. */
function normalizeCapture(providerCode: string, event: VerifiedWebhook): Capture | null {
  const root = asRecord(event.payload);
  const entity = asRecord(asRecord(root.payload).entity);
  if (providerCode === "razorpay") {
    if (event.type === "payment_link.paid") {
      const link = asRecord(asRecord(root.payload).payment_link).entity as Record<string, unknown>;
      const payments = (link.payments ?? []) as Array<{ id: string; amount: number; currency: string }>;
      const pay = payments[payments.length - 1];
      const amountMinor = pay ? BigInt(pay.amount) : BigInt(Number(link.amount_paid ?? 0));
      if (!link.id || amountMinor <= 0n) return null;
      return {
        matchByProviderRef: String(link.id),
        paymentRef: pay?.id ?? String(link.id),
        amountMinor,
        currency: String(pay?.currency ?? "INR"),
      };
    }
    if (event.type === "payment.captured") {
      if (!entity.id) return null;
      const notes = asRecord(entity.notes);
      const linkId = (entity.link_id ?? notes.link_id) as string | undefined;
      return {
        matchByProviderRef: linkId ? String(linkId) : undefined,
        matchByInvoiceId: typeof notes.invoiceId === "string" ? notes.invoiceId : undefined,
        paymentRef: String(entity.id),
        amountMinor: BigInt(Number(entity.amount ?? 0)),
        currency: String(entity.currency ?? "INR"),
      };
    }
    return null;
  }
  if (providerCode === "stripe") {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const obj = asRecord(asRecord(root.payload).checkout_session).object as Record<string, unknown>;
      const meta = asRecord(obj.metadata);
      if (!obj.id) return null;
      return {
        matchByProviderRef: String(obj.id),
        matchByInvoiceId: typeof meta.invoiceId === "string" ? meta.invoiceId : undefined,
        paymentRef: String(obj.payment_intent ?? obj.id),
        amountMinor: BigInt(Number(obj.amount_total ?? 0)),
        currency: String(obj.currency ?? "usd").toUpperCase(),
      };
    }
    return null;
  }
  return null;
}

/**
 * Verifies a provider webhook against the raw body (platform gateway first, then
 * organization-scoped gateways), stores it idempotently, and settles the matching
 * invoice exactly once. Signature failure never reaches data mutation.
 */
export async function processWebhook(
  providerCode: string,
  rawBody: string,
  headers: Headers,
): Promise<{ handled: boolean; reason?: string }> {
  const provider: GatewayProvider = getGatewayProvider(providerCode);
  const candidates = await db.gatewayConfig.findMany({ where: { providerCode, active: true } });
  let verified: { cfg: GatewayConfig; event: VerifiedWebhook } | null = null;
  for (const cfg of candidates) {
    try {
      const event = provider.verifyWebhook(cfg, gatewayWebhookSecret(cfg), rawBody, headers);
      verified = { cfg, event };
      break;
    } catch {
      continue;
    }
  }
  if (!verified) {
    throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "No configured gateway accepted this webhook signature");
  }
  const { cfg, event } = verified;

  const stored = await db.webhookEvent
    .create({
      data: {
        gatewayConfigId: cfg.id,
        providerCode,
        externalId: event.externalId,
        type: event.type,
        payload: event.payload as Prisma.InputJsonValue,
        status: "RECEIVED",
      },
    })
    .catch(() => null);
  if (!stored) return { handled: false, reason: "duplicate" };

  try {
    const capture = normalizeCapture(providerCode, event);
    if (!capture || capture.amountMinor <= 0n) {
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "IGNORED_UNKNOWN", processedAt: new Date() } });
      return { handled: false, reason: "unhandled_event_type" };
    }
    const invoice = capture.matchByInvoiceId
      ? await db.invoice.findFirst({ where: { id: capture.matchByInvoiceId, orgId: cfg.orgId ?? undefined } })
      : capture.matchByProviderRef
        ? await db.invoice.findFirst({ where: { gatewayCheckoutRef: capture.matchByProviderRef } })
        : null;
    if (!invoice) {
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "IGNORED_UNKNOWN", processedAt: new Date(), error: "invoice not found" } });
      return { handled: false, reason: "unknown_invoice" };
    }
    const existing = await db.payment.findFirst({
      where: { gatewayPaymentRef: capture.paymentRef, status: { in: ["COMPLETED", "PENDING"] } },
    });
    if (existing) {
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "IGNORED_DUPLICATE", processedAt: new Date() } });
      return { handled: true, reason: "already_settled" };
    }
    const outstanding = invoice.totalMinor - invoice.paidMinor;
    const amount = capture.amountMinor > outstanding ? outstanding : capture.amountMinor;
    if (amount <= 0n) {
      await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "IGNORED_DUPLICATE", processedAt: new Date() } });
      return { handled: true, reason: "nothing_due" };
    }
    await db.$transaction(async (tx) => {
      await settleInvoicePayment(tx, {
        orgId: invoice.orgId,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        amountMinor: amount,
        currencyCode: invoice.currencyCode,
        method: "GATEWAY",
        paidAt: new Date(),
        reference: `${providerCode}:${capture.paymentRef}`,
        note: "Settled via provider webhook",
        gatewayConfigId: cfg.id,
        gatewayPaymentRef: capture.paymentRef,
        recordedByUserId: await billingActorUserId(tx),
      });
      if (invoice.subscriptionId) {
        const cycle = await tx.billingCycle.findFirst({ where: { invoiceId: invoice.id } });
        if (cycle) await tx.billingCycle.update({ where: { id: cycle.id }, data: { status: "PAID" } });
        const sub = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } });
        if (sub && ["PAST_DUE", "GRACE_PERIOD"].includes(sub.status)) {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE" } });
        }
      }
    });
    await db.webhookEvent.update({ where: { id: stored.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    return { handled: true };
  } catch (err) {
    await db.webhookEvent.update({
      where: { id: stored.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : "unknown" },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Subscription renewal (scheduled)
// ---------------------------------------------------------------------------

export type RenewalResult = { renewed: number; invoiced: number; pastDue: number; expired: number };

export async function renewDueSubscriptions(): Promise<RenewalResult> {
  const now = new Date();
  const result: RenewalResult = { renewed: 0, invoiced: 0, pastDue: 0, expired: 0 };

  const due = await db.subscription.findMany({
    where: {
      status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] },
      currentPeriodEnd: { lte: now },
    },
    include: { plan: true },
  });

  for (const sub of due) {
    const unpaid = await db.invoice.count({
      where: { subscriptionId: sub.id, status: { notIn: ["PAID", "VOID"] } },
    });

    if (sub.status === "PAST_DUE" || sub.status === "GRACE_PERIOD") {
      // Collection already attempted. If still unpaid at grace end, let it lapse.
      const next = sub.status === "PAST_DUE" ? "GRACE_PERIOD" : "EXPIRED";
      await db.subscription.update({ where: { id: sub.id }, data: { status: next } });
      result.pastDue++;
      continue;
    }
    if (unpaid > 0) {
      await db.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
      result.pastDue++;
      continue;
    }
    if (sub.cancelAtPeriodEnd) {
      await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: now } });
      result.expired++;
      continue;
    }
    const start = sub.currentPeriodEnd;
    const end = addInterval(start, sub.plan.interval);
    await db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE", currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null },
      });
      const cycle = await tx.billingCycle.create({
        data: { subscriptionId: sub.id, periodStart: start, periodEnd: end, status: "PENDING" },
      });
      const inv = await createTenantInvoice(tx, sub.orgId, sub.id, sub.plan, sub.seats, start, end);
      await tx.billingCycle.update({ where: { id: cycle.id }, data: { status: "INVOICED", invoiceId: inv.id } });
      await logActivity(tx, {
        orgId: sub.orgId,
        userId: null,
        action: "subscription.renewed",
        entityType: "SUBSCRIPTION",
        entityId: sub.id,
        meta: { periodEnd: end.toISOString(), invoiceNumber: inv.number },
      });
    });
    result.renewed++;
    result.invoiced++;
  }

  // Trials still inside their paid period but past trial end convert without billing yet.
  const trials = await db.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { lte: now }, currentPeriodEnd: { gt: now } },
    include: { plan: true },
  });
  for (const sub of trials) {
    if (sub.cancelAtPeriodEnd) {
      await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: now } });
      result.expired++;
      continue;
    }
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", currentPeriodEnd: sub.trialEndsAt ?? sub.currentPeriodEnd, trialEndsAt: null },
    });
    result.renewed++;
  }

  return result;
}
