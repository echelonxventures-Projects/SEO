// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { unshareCalendar } from "@/server/services/temporal.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]/shares/[shareId]">,
): Promise<Response> {
  const { id, shareId } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      await unshareCalendar(ctxOf(viewer!, ip), id, shareId);
      return ok(null);
    },
  );
}
