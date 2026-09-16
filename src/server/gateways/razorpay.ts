import crypto from "node:crypto";
import { AppError, ErrorCodes } from "../errors";
import type { CheckoutParams, GatewayProvider, RefundResult, VerifiedWebhook } from "./types";

const API = "https://api.razorpay.com/v1";

type Credential = { keyId: string; keySecret: string };

function authHeader(cred: Credential): string {
  return "Basic " + Buffer.from(`${cred.keyId}:${cred.keySecret}`).toString("base64");
}

async function rzFetch<T>(path: string, init: RequestInit, cred: Credential): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(cred),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(ErrorCodes.GATEWAY_ERROR, `Razorpay API error ${res.status}`, body.slice(0, 2000));
  }
  return res.json() as Promise<T>;
}

/**
 * Razorpay adapter — uses Payment Links for hosted collection so the platform
 * never handles card data (PCI SAQ-A). Webhooks are HMAC-SHA256 verified over
 * the raw body. Refunds via the Refunds API.
 */
export const razorpayProvider: GatewayProvider = {
  code: "razorpay",
  label: "Razorpay",
  supportsSandbox: true,

  async createCheckout(config, credential, params: CheckoutParams) {
    const cred = credential as unknown as Credential;
    if (config.mode === "LIVE" && cred.keyId.startsWith("rzp_test_")) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Sandbox key configured for LIVE mode");
    }
    if (config.mode === "SANDBOX" && !cred.keyId.startsWith("rzp_test_")) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Live key configured for SANDBOX mode");
    }
    const link = await rzFetch<{
      id: string;
      short_url: string;
      status: string;
      expire_at?: number;
    }>(
      "/payment_links",
      {
        method: "POST",
        body: JSON.stringify({
          amount: Number(params.amountMinor),
          currency: params.currency.toUpperCase(),
          accept_partial: false,
          reference_id: params.invoiceId,
          description: params.description.slice(0, 2048),
          notify: { sms: false, email: Boolean(params.payerEmail) },
          notes: { invoiceId: params.invoiceId },
          customer: params.payerEmail
            ? { name: params.payerName ?? undefined, email: params.payerEmail ?? undefined, contact: undefined }
            : undefined,
          reminder_enable: true,
          callback_url: params.successUrl,
          callback_method: "get",
        }),
      },
      cred,
    );
    if (!link.id || !link.short_url) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Razorpay did not return a payment link");
    }
    return {
      providerRef: link.id,
      mode: "redirect",
      url: link.short_url,
      expiresAt: link.expire_at ? new Date(link.expire_at * 1000) : undefined,
    };
  },

  verifyWebhook(config, secret, rawBody, headers): VerifiedWebhook {
    const signature = headers.get("x-razorpay-signature");
    if (!secret || !signature) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Missing webhook secret or signature");
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Invalid Razorpay webhook signature");
    }
    let payload: { id?: string; event?: string };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Webhook body is not valid JSON");
    }
    if (!payload.id || !payload.event) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Webhook payload missing id/event");
    }
    void config;
    return { externalId: payload.id, type: payload.event, payload };
  },

  async refund(config, credential, params): Promise<RefundResult> {
    const cred = credential as unknown as Credential;
    void config;
    const created = await rzFetch<{ id: string; status: string }>(
      `/payments/${encodeURIComponent(params.paymentRef)}/refund`,
      {
        method: "POST",
        body: JSON.stringify({ amount: Number(params.amountMinor), speed: "normal" }),
      },
      cred,
    );
    const status =
      created.status === "processed" ? "succeeded" : created.status === "failed" ? "failed" : "pending";
    return { refundRef: created.id, status };
  },
};
