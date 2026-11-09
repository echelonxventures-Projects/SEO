import crypto from "node:crypto";
import { AppError, ErrorCodes } from "../errors";
import type { CheckoutParams, GatewayProvider, RefundResult, VerifiedWebhook } from "./types";

const API = "https://api.stripe.com/v1";

type Credential = { secretKey: string; webhookSecret: string | null };

async function stFetch<T>(path: string, body: URLSearchParams, cred: Credential): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AppError(ErrorCodes.GATEWAY_ERROR, `Stripe API error ${res.status}`, text.slice(0, 2000));
  }
  return res.json() as Promise<T>;
}

/**
 * Stripe adapter — Checkout Sessions (mode=payment) for hosted collection.
 * Webhook verification implements Stripe's signed-header scheme
 * (t=timestamp, v1=HMAC-SHA256 over `${t}.${rawBody}`) with replay tolerance.
 */
export const stripeProvider: GatewayProvider = {
  code: "stripe",
  label: "Stripe",
  supportsSandbox: true,

  async createCheckout(config, credential, params: CheckoutParams) {
    const cred = credential as unknown as Credential;
    const isTest = cred.secretKey.startsWith("sk_test_");
    if (config.mode === "LIVE" && isTest) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Test key configured for LIVE mode");
    }
    if (config.mode === "SANDBOX" && !isTest) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Live key configured for SANDBOX mode");
    }
    const body = new URLSearchParams({
      mode: "payment",
      "payment_method_types[]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(Number(params.amountMinor)),
      "line_items[0][price_data][product_data][name]": params.description.slice(0, 255),
      "metadata[invoiceId]": params.invoiceId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      "invoice_creation[enabled]": "false",
    });
    if (params.payerEmail) body.set("customer_email", params.payerEmail);
    const session = await stFetch<{ id: string; url: string | null }>(
      "/checkout/sessions",
      body,
      cred,
    );
    if (!session.url) {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "Stripe returned a session without a hosted URL");
    }
    return { providerRef: session.id, mode: "redirect", url: session.url };
  },

  verifyWebhook(_config, secret, rawBody, headers): VerifiedWebhook {
    const header = headers.get("stripe-signature");
    if (!secret || !header) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Missing Stripe webhook secret or signature header");
    }
    // Stripe may send several v1 signatures (e.g. during secret rotation).
    let t: string | undefined;
    const v1s: string[] = [];
    for (const kv of header.split(",")) {
      const idx = kv.indexOf("=");
      if (idx < 0) continue;
      const k = kv.slice(0, idx).trim();
      const v = kv.slice(idx + 1).trim();
      if (k === "t") t = v;
      else if (k === "v1") v1s.push(v);
    }
    const parts = { t };
    if (!parts.t || v1s.length === 0) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Malformed Stripe signature header");
    }
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Stripe webhook timestamp outside tolerance");
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    const b = Buffer.from(expected);
    const matches = v1s.some((sig) => {
      const a = Buffer.from(sig);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!matches) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Invalid Stripe webhook signature");
    }
    let payload: { id?: string; type?: string };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Webhook body is not valid JSON");
    }
    if (!payload.id || !payload.type) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE, "Webhook payload missing id/type");
    }
    return { externalId: payload.id, type: payload.type, payload };
  },

  async refund(_config, credential, params): Promise<RefundResult> {
    const cred = credential as unknown as Credential;
    const body = new URLSearchParams({
      payment_intent: params.paymentRef,
      amount: String(Number(params.amountMinor)),
    });
    const r = await stFetch<{ id: string; status: string }>(
      "/refunds",
      body,
      cred,
    );
    const status = r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "pending";
    return { refundRef: r.id, status };
  },
};
