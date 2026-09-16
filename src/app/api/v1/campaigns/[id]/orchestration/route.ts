// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getOrchestration } from "@/server/services/orchestrator.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/campaigns/[id]/orchestration">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await getOrchestration(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
