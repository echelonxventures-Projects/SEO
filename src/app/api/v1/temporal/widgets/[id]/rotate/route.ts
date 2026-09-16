// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { rotateWidgetToken } from "@/server/services/temporal-widgets.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/widgets/[id]/rotate">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await rotateWidgetToken(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
