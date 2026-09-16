// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { resumeSubscription } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "subscription.manage" },
    async ({ viewer, ip }) => {
      await resumeSubscription(ctxOf(viewer!, ip));
      return ok(null);
    },
  );
}
