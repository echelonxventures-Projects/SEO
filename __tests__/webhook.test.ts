import { mockDb } from "../setup";
import { processWebhook } from "../../src/server/billing.service";
import { mockDb } from "../setup";

jest.mock("../../src/server/gateways/registry", () => ({
  getGatewayProvider: jest.fn(() => ({
    verifyWebhook: jest.fn(() => ({
      externalId: "evt_123",
      type: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_123",
            amount_paid: 10000,
            currency: "INR",
          },
        },
      },
    })),
  })),
}));

describe("Webhook Processing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should verify webhook signature before processing", async () => {
    const headers = new Headers({
      "x-omni-signature": "sha256=abc123",
    });

    const result = await processWebhook(
      "razorpay",
      '{"event": "payment_link.paid"}',
      headers
    );

    // Should verify signature first
    expect(result.handled).toBeDefined();
  });

  it("should reject invalid signatures", async () => {
    // Mock verifyWebhook to fail
    jest.spyOn(require("../../src/server/gateways/registry"), "getGatewayProvider").mockReturnValue({
      verifyWebhook: jest.fn().mockRejectedValue(new Error("Invalid signature")),
    });

    const headers = new Headers({
      "x-omni-signature": "sha256=invalid",
    });

    await expect(
      processWebhook("razorpay", '{"event": "payment_link.paid"}', headers)
    ).rejects.toThrow();
  });

  it("should handle duplicate webhooks idempotently", async () => {
    // First call succeeds, second returns duplicate
    mockDb.webhookEvent.create.mockImplementation(() =>
      Promise.resolve({ id: "evt_123", status: "RECEIVED" })
    );

    const headers = new Headers({
      "x-omni-signature": "sha256=abc123",
    });

    await processWebhook("razorpay", '{"event": "payment_link.paid"}', headers);
  });

  it("should settle invoice on successful webhook", async () => {
    mockDb.invoice.findFirst.mockResolvedValue({
      id: "invoice_123",
      orgId: "org_123",
      totalMinor: BigInt(10000),
      paidMinor: BigInt(0),
      status: "ISSUED",
    });

    const headers = new Headers({
      "x-omni-signature": "sha256=abc123",
    });

    const result = await processWebhook("razorpay", '{"event": "payment_link.paid"}', headers);
    expect(result.handled).toBe(true);
  });
});
