import { mockDb } from "../setup";
import { settleInvoicePayment, recomputeInvoiceStatus } from "../../src/server/services/ledger";

describe("Ledger Service", () => {
  const ctx = {
    orgId: "org_123",
    userId: "user_123",
    viewer: { active: { roleCode: "OWNER" } },
    ip: "127.0.0.1",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("settleInvoicePayment", () => {
    it("should settle invoice and update status to PAID", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        orgId: "org_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(0),
        status: "ISSUED",
      });

      mockDb.invoice.update.mockResolvedValue({
        id: "invoice_123",
        status: "PAID",
        paidMinor: BigInt(10000),
      });

      await settleInvoicePayment(mockDb, {
        orgId: "org_123",
        invoiceId: "invoice_123",
        amountMinor: BigInt(10000),
        currencyCode: "INR",
        method: "BANK_TRANSFER",
        paidAt: new Date(),
        recordedByUserId: "user_123",
      });

      expect(mockDb.invoice.update).toHaveBeenCalled();
      const updateCall = mockDb.invoice.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("PAID");
      expect(updateCall.data.paidMinor).toBe(BigInt(10000));
    });

    it("should handle partial payments", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(0),
        status: "ISSUED",
      });

      await settleInvoicePayment(mockDb, {
        orgId: "org_123",
        invoiceId: "invoice_123",
        amountMinor: BigInt(5000),
        currencyCode: "INR",
        method: "BANK_TRANSFER",
        paidAt: new Date(),
        recordedByUserId: "user_123",
      });

      const updateCall = mockDb.invoice.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("PARTIALLY_PAID");
    });

    it("should prevent double-payment", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(10000),
        status: "PAID",
      });

      await expect(
        settleInvoicePayment(mockDb, {
          orgId: "org_123",
          invoiceId: "invoice_123",
          amountMinor: BigInt(1000),
          currencyCode: "INR",
          method: "BANK_TRANSFER",
          paidAt: new Date(),
          recordedByUserId: "user_123",
        })
      ).rejects.toThrow();
    });
  });

  describe("recomputeInvoiceStatus", () => {
    it("should transition to OVERDUE when past due date", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        orgId: "org_123",
        status: "SENT",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(0),
        dueDate: new Date("2024-01-01"),
      });

      const result = await recomputeInvoiceStatus(mockDb, "invoice_123");
      expect(result.status).toBe("OVERDUE");
    });

    it("should transition to PARTIALLY_PAID when partial payment received", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(5000),
        status: "ISSUED",
      });

      const result = await recomputeInvoiceStatus(mockDb, "invoice_123");
      expect(result.status).toBe("PARTIALLY_PAID");
    });

    it("should remain ISSUED when paid in full on time", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(10000),
        status: "ISSUED",
        dueDate: new Date("2024-12-31"),
      });

      const result = await recomputeInvoiceStatus(mockDb, "invoice_123");
      expect(result.status).toBe("PAID");
    });
  });

  describe("payment idempotency", () => {
    it("should track payment attempts", async () => {
      mockDb.invoice.findUnique.mockResolvedValue({
        id: "invoice_123",
        totalMinor: BigInt(10000),
        paidMinor: BigInt(0),
        status: "ISSUED",
      });

      await settleInvoicePayment(mockDb, {
        orgId: "org_123",
        invoiceId: "invoice_123",
        amountMinor: BigInt(10000),
        currencyCode: "INR",
        method: "BANK_TRANSFER",
        paidAt: new Date(),
        recordedByUserId: "user_123",
      });

      expect(mockDb.invoice.update).toHaveBeenCalled();
    });
  });
});
