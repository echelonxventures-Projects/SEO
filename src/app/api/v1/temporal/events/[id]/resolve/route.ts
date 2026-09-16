// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { resolveEventDeps } from "@/server/services/temporal-intelligence.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/events/[id]/resolve">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await resolveEventDeps(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
