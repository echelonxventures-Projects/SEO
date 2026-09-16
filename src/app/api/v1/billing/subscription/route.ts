// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getBillingState } from "@/server/services/billing.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "subscription.read" },
    async ({ viewer, ip }) => {
      const data = await getBillingState(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}
