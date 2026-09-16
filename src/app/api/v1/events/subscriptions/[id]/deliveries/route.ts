// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deliveriesApi } from "@/server/services/events-api";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/events/subscriptions/[id]/deliveries">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const data = await deliveriesApi(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
