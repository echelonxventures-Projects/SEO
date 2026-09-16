// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deleteTransport } from "@/server/services/temporal-stream.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/stream/transports/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.manage" },
    async ({ viewer, ip }) => {
      await deleteTransport(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
