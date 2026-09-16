// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { syncConnection } from "@/server/services/temporal-connectors.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/connectors/[id]/sync">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await syncConnection(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
