import { createFakeDb, type FakeDb } from "./fake-db";

jest.mock("../src/server/db", () => ({ db: {} }));

import { recomputeInvoiceStatus, settleInvoicePayment } from "../src/server/services/ledger";

type Tx = Parameters<typeof settleInvoicePayment>[0];

async function seedInvoice(db: FakeDb, over: Record<string, unknown> = {}) {
  return db.invoice.create({
    data: {
      orgId: "org_1",
      clientId: "client_1",
      status: "SENT",
      totalMinor: 10_000n,
      paidMinor: 0n,
      currencyCode: "INR",
      dueDate: new Date(Date.now() + 86400_000),
      ...over,
    },
  });
}

const settle = (db: FakeDb, invoiceId: string, amountMinor: bigint) =>
  settleInvoicePayment(db as unknown as Tx, {
    orgId: "org_1",
    invoiceId,
    clientId: "client_1",
    amountMinor,
    currencyCode: "INR",
    method: "BANK_TRANSFER",
    paidAt: new Date(),
    recordedByUserId: "user_1",
  });

describe("settleInvoicePayment", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = createFakeDb();
  });

  it("records a numbered payment and marks a fully paid invoice PAID", async () => {
    const inv = await seedInvoice(db);
    const payment = await settle(db, inv.id, 10_000n);
    expect(payment.number).toMatch(/^PAY-\d{4}$/);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.paidMinor).toBe(10_000n);
    expect(after.status).toBe("PAID");
    expect(db.domainEvent.rows.map((e) => e.type).sort()).toEqual(["invoice.paid", "payment.recorded"]);
  });

  it("marks partial payments PARTIALLY_PAID", async () => {
    const inv = await seedInvoice(db);
    await settle(db, inv.id, 4_000n);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(db.domainEvent.rows.map((e) => e.type)).toEqual(["payment.recorded"]);
  });

  it("refuses payments above the outstanding balance", async () => {
    const inv = await seedInvoice(db, { paidMinor: 6_000n });
    await expect(settle(db, inv.id, 5_000n)).rejects.toThrow("exceeds the outstanding balance");
    expect(db.payment.rows).toHaveLength(0);
  });

  it.each(["DRAFT", "VOID"])("refuses to settle %s invoices", async (status) => {
    const inv = await seedInvoice(db, { status });
    await expect(settle(db, inv.id, 100n)).rejects.toThrow("draft or void");
  });
});

describe("recomputeInvoiceStatus", () => {
  it("flags unpaid invoices past due as OVERDUE", async () => {
    const db = createFakeDb();
    const inv = await seedInvoice(db, { dueDate: new Date(Date.now() - 86400_000) });
    await recomputeInvoiceStatus(db as unknown as Tx, inv.id);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("OVERDUE");
  });

  it("leaves DRAFT invoices untouched", async () => {
    const db = createFakeDb();
    const inv = await seedInvoice(db, { status: "DRAFT", paidMinor: 10_000n });
    await recomputeInvoiceStatus(db as unknown as Tx, inv.id);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DRAFT");
  });
});
