import type { GatewayConfig } from "@/generated/prisma/client";

export type CheckoutParams = {
  invoiceId: string;
  amountMinor: bigint;
  currency: string;
  payerEmail: string | null;
  payerName: string | null;
  description: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult = {
  providerRef: string; // link id / session id stored on the invoice
  /**
   * redirect  -> send the payer to url
   * sdk       -> client must launch the provider SDK with clientSecret (Razorpay checkout.js etc.)
   * complete  -> payment already settled (sandbox/mock)
   */
  mode: "redirect" | "sdk" | "complete";
  url?: string;
  clientSecret?: string;
  expiresAt?: Date;
};

export type VerifiedWebhook = {
  externalId: string;
  type: string;
  payload: unknown;
};

export type RefundResult = {
  refundRef: string;
  status: "succeeded" | "pending" | "failed";
};

/**
 * Every payment provider implements this contract. Secrets live encrypted in
 * GatewayConfig rows; providers receive the decrypted credential object only
 * inside the call and must never persist or log it.
 */
export interface GatewayProvider {
  code: string;
  label: string;
  supportsSandbox: boolean;
  createCheckout(config: GatewayConfig, credential: Record<string, string>, params: CheckoutParams): Promise<CheckoutResult>;
  /** Verify signature over the RAW request body and normalise the event. Throws on bad signature. */
  verifyWebhook(config: GatewayConfig, secret: string | null, rawBody: string, headers: Headers): VerifiedWebhook;
  refund(config: GatewayConfig, credential: Record<string, string>, params: { paymentRef: string; amountMinor: bigint; currency: string }): Promise<RefundResult>;
}
