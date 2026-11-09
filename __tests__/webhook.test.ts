import crypto from "node:crypto";
import { createFakeDb, type FakeDb } from "./fake-db";

// The real billing service runs against an in-memory DB. Webhook secrets are
// stored "encrypted" as { plain } and decrypted by a stub, so tests control
// exactly which gateway's secret signs a payload.
const holder: { db: FakeDb } = { db: createFakeDb() };
jest.mock("../src/server/db", () => ({
  get db() {
    return holder.db;
  },
}));
jest.mock("../src/server/crypto", () => ({
  ...jest.requireActual("../src/server/crypto"),
  decryptSecret: (enc: { plain: string }) => enc.plain,
}));
jest.mock("../src/generated/prisma/client", () => ({ Prisma: {} }));

import { processWebhook } from "../src/server/services/billing.service";

const PLATFORM_SECRET = "whsec_platform_secret";
const TENANT_SECRET = "whsec_tenant_chosen_secret";

function rzSigned(body: object, secret: string) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return { raw, headers: new Headers({ "x-razorpay-signature": sig }) };
}

function linkPaid(eventId: string, linkId: string, amount: number, payId = `pay_${eventId}`, currency = "INR") {
  return {
    id: eventId,
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: linkId, amount_paid: amount, payments: [{ id: payId, amount, currency }] } },
    },
  };
}

async function setup() {
  const db = createFakeDb();
  holder.db = db;
  await db.user.create({ data: { isPlatformAdmin: true, createdAt: new Date(0) } });
  await db.gatewayConfig.create({
    data: { providerCode: "razorpay", scope: "PLATFORM", orgId: null, active: true, webhookSecretEnc: { plain: PLATFORM_SECRET } },
  });
  // Workspace-owned gateway: the tenant chose this webhook secret themselves.
  await db.gatewayConfig.create({
    data: { providerCode: "razorpay", scope: "ORGANIZATION", orgId: "org_tenant", active: true, webhookSecretEnc: { plain: TENANT_SECRET } },
  });
  const subscriptionInvoice = await db.invoice.create({
    data: {
      orgId: "org_tenant", partyKind: "TENANT", status: "SENT", totalMinor: 99_900n, paidMinor: 0n,
      currencyCode: "INR", gatewayCheckoutRef: "plink_platform_sub", clientId: null, subscriptionId: null,
    },
  });
  const clientInvoice = await db.invoice.create({
    data: {
      orgId: "org_tenant", partyKind: "CLIENT", status: "SENT", totalMinor: 50_000n, paidMinor: 0n,
      currencyCode: "INR", gatewayCheckoutRef: "plink_client", clientId: "client_1", subscriptionId: null,
    },
  });
  const otherTenantInvoice = await db.invoice.create({
    data: {
      orgId: "org_other", partyKind: "CLIENT", status: "SENT", totalMinor: 70_000n, paidMinor: 0n,
      currencyCode: "INR", gatewayCheckoutRef: "plink_other", clientId: "client_9", subscriptionId: null,
    },
  });
  return { db, subscriptionInvoice, clientInvoice, otherTenantInvoice };
}

const paid = async (db: FakeDb, id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).paidMinor;

describe("processWebhook — signature", () => {
  it("rejects payloads no configured gateway signed", async () => {
    await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_1", "plink_client", 50_000), "wrong-secret");
    await expect(processWebhook("razorpay", raw, headers)).rejects.toThrow("No configured gateway");
  });
});

describe("processWebhook — tenancy boundary", () => {
  it("settles a workspace CLIENT invoice via that workspace's gateway", async () => {
    const { db, clientInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_ok", "plink_client", 50_000), TENANT_SECRET);
    await expect(processWebhook("razorpay", raw, headers)).resolves.toEqual({ handled: true });
    expect(await paid(db, clientInvoice.id)).toBe(50_000n);
  });

  it("a tenant cannot pay its own platform subscription with a self-signed webhook", async () => {
    const { db, subscriptionInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_forge", "plink_platform_sub", 99_900), TENANT_SECRET);
    await expect(processWebhook("razorpay", raw, headers)).resolves.toMatchObject({ handled: false, reason: "unknown_invoice" });
    expect(await paid(db, subscriptionInvoice.id)).toBe(0n);
    expect(db.payment.rows).toHaveLength(0);
  });

  it("a tenant cannot settle another tenant's invoice", async () => {
    const { db, otherTenantInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_cross", "plink_other", 70_000), TENANT_SECRET);
    await expect(processWebhook("razorpay", raw, headers)).resolves.toMatchObject({ reason: "unknown_invoice" });
    expect(await paid(db, otherTenantInvoice.id)).toBe(0n);
  });

  it("the platform gateway settles TENANT invoices only", async () => {
    const { db, subscriptionInvoice, clientInvoice } = await setup();
    const a = rzSigned(linkPaid("evt_p1", "plink_platform_sub", 99_900), PLATFORM_SECRET);
    await expect(processWebhook("razorpay", a.raw, a.headers)).resolves.toEqual({ handled: true });
    expect(await paid(db, subscriptionInvoice.id)).toBe(99_900n);

    const b = rzSigned(linkPaid("evt_p2", "plink_client", 50_000), PLATFORM_SECRET);
    await expect(processWebhook("razorpay", b.raw, b.headers)).resolves.toMatchObject({ reason: "unknown_invoice" });
    expect(await paid(db, clientInvoice.id)).toBe(0n);
  });
});

describe("processWebhook — money safety", () => {
  it("ignores a currency that doesn't match the invoice", async () => {
    const { db, clientInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_usd", "plink_client", 50_000, "pay_usd", "USD"), TENANT_SECRET);
    await expect(processWebhook("razorpay", raw, headers)).resolves.toMatchObject({ reason: "currency_mismatch" });
    expect(await paid(db, clientInvoice.id)).toBe(0n);
  });

  it("drops an exact redelivery of a processed event", async () => {
    const { db, clientInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_dup", "plink_client", 50_000), TENANT_SECRET);
    await processWebhook("razorpay", raw, headers);
    await expect(processWebhook("razorpay", raw, headers)).resolves.toMatchObject({ reason: "duplicate" });
    expect(await paid(db, clientInvoice.id)).toBe(50_000n);
  });

  it("never settles the same provider payment twice across different events", async () => {
    const { db, clientInvoice } = await setup();
    const a = rzSigned(linkPaid("evt_a", "plink_client", 20_000, "pay_same"), TENANT_SECRET);
    const b = rzSigned(linkPaid("evt_b", "plink_client", 20_000, "pay_same"), TENANT_SECRET);
    await processWebhook("razorpay", a.raw, a.headers);
    await expect(processWebhook("razorpay", b.raw, b.headers)).resolves.toMatchObject({ reason: "already_settled" });
    expect(await paid(db, clientInvoice.id)).toBe(20_000n);
    expect(db.payment.rows).toHaveLength(1);
  });

  it("clamps overpayment to the outstanding balance", async () => {
    const { db, clientInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_over", "plink_client", 80_000), TENANT_SECRET);
    await processWebhook("razorpay", raw, headers);
    expect(await paid(db, clientInvoice.id)).toBe(50_000n);
  });

  it("re-processes a provider retry of an event that previously FAILED", async () => {
    const { db, clientInvoice } = await setup();
    const { raw, headers } = rzSigned(linkPaid("evt_retry", "plink_client", 50_000), TENANT_SECRET);
    // First delivery fails mid-settlement (e.g. transient DB error).
    const original = db.payment.create;
    db.payment.create = async () => {
      throw new Error("connection reset");
    };
    await expect(processWebhook("razorpay", raw, headers)).rejects.toThrow("connection reset");
    expect(db.webhookEvent.rows[0].status).toBe("FAILED");
    db.payment.create = original;
    // Provider retries the same event id — it must settle now, not be dropped.
    await expect(processWebhook("razorpay", raw, headers)).resolves.toEqual({ handled: true });
    expect(await paid(db, clientInvoice.id)).toBe(50_000n);
    expect(db.webhookEvent.rows[0].status).toBe("PROCESSED");
  });
});

describe("processWebhook — Stripe", () => {
  function stripeSigned(body: object, secret: string, extraV1 = false) {
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    const header = extraV1 ? `t=${t},v1=${"0".repeat(64)},v1=${sig}` : `t=${t},v1=${sig}`;
    return { raw, headers: new Headers({ "stripe-signature": header }) };
  }

  it("settles checkout.session.completed using the real event envelope (data.object)", async () => {
    const db = createFakeDb();
    holder.db = db;
    await db.user.create({ data: { isPlatformAdmin: true } });
    await db.gatewayConfig.create({
      data: { providerCode: "stripe", scope: "ORGANIZATION", orgId: "org_s", active: true, webhookSecretEnc: { plain: "whsec_s" } },
    });
    const inv = await db.invoice.create({
      data: { orgId: "org_s", partyKind: "CLIENT", status: "SENT", totalMinor: 4_200n, paidMinor: 0n, currencyCode: "USD", gatewayCheckoutRef: "cs_1", clientId: "c", subscriptionId: null },
    });
    const event = {
      id: "evt_stripe_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_intent: "pi_1", amount_total: 4_200, currency: "usd", payment_status: "paid", metadata: {} } },
    };
    // Two v1 signatures (secret rotation) — any valid one must be accepted.
    const { raw, headers } = stripeSigned(event, "whsec_s", true);
    await expect(processWebhook("stripe", raw, headers)).resolves.toEqual({ handled: true });
    expect(await paid(db, inv.id)).toBe(4_200n);
  });
});
