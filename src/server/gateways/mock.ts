import { randomToken, sha256 } from "../crypto";
import { AppError, ErrorCodes } from "../errors";
import type { CheckoutParams, GatewayProvider, RefundResult, VerifiedWebhook } from "./types";

const REF_PREFIX = "omnimark_mock";

/**
 * Fully deterministic sandbox gateway used for local/dev/testing flows.
 * It never touches the network and is refused for LIVE mode. A payment is
 * settled by posting to the mock pay endpoint (see /api/v1/pay/mock/[token]).
 */
export const mockProvider: GatewayProvider = {
  code: "mock",
  label: "Mock (sandbox only)",
  supportsSandbox: true,

  async createCheckout(config, credential, params: CheckoutParams) {
    if (config.mode === "LIVE") {
      throw new AppError(ErrorCodes.GATEWAY_ERROR, "The mock gateway cannot be used in LIVE mode");
    }
    void credential;
    void params;
    const linkId = `${REF_PREFIX}_link_${randomToken(10)}`;
    // No hosted URL: the caller falls back to the app's own /pay/<token> page,
    // which settles via settleByCheckoutToken().
    return {
      providerRef: linkId,
      mode: "complete" as const,
    };
  },

  verifyWebhook(): VerifiedWebhook {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      "The mock gateway does not emit webhooks; payments settle via the pay endpoint",
    );
  },

  async refund(_config, _credential, params): Promise<RefundResult> {
    return { refundRef: `${REF_PREFIX}_re_${sha256(params.paymentRef).slice(0, 12)}`, status: "succeeded" };
  },
};
