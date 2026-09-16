// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { retryTarget } from "@/server/services/content.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/content/targets/[id]/retry">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.publish" },
    async ({ viewer, ip }) => {
      await retryTarget(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
