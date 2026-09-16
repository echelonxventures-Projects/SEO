// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { readReplay } from "@/server/services/temporal-library.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/governance/replay/[entityType]/[entityId]">,
): Promise<Response> {
  const { entityType, entityId } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await readReplay(ctxOf(viewer!, ip), entityType, entityId, req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}
