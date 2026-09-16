// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { releaseBooking } from "@/server/services/temporal-resources.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/bookings/[id]/release">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "resource.write" },
    async ({ viewer, ip }) => {
      await releaseBooking(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
