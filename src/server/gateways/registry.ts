import { AppError, ErrorCodes } from "../errors";
import { mockProvider } from "./mock";
import { razorpayProvider } from "./razorpay";
import { stripeProvider } from "./stripe";
import type { GatewayProvider } from "./types";

const providers = new Map<string, GatewayProvider>([
  [mockProvider.code, mockProvider],
  [razorpayProvider.code, razorpayProvider],
  [stripeProvider.code, stripeProvider],
]);

export function getGatewayProvider(code: string): GatewayProvider {
  const p = providers.get(code.toLowerCase());
  if (!p) {
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `Unknown payment provider "${code}". Available: ${[...providers.keys()].join(", ")}`,
    );
  }
  return p;
}

export function listGatewayProviders() {
  return [...providers.values()].map((p) => ({ code: p.code, label: p.label, supportsSandbox: p.supportsSandbox }));
}
