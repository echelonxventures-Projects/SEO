// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { cancelFlight } from "@/server/services/calendar.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/flights/[id]/cancel">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      await cancelFlight(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
