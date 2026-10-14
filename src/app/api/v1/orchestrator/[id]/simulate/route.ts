// Orchestrator API — campaign composition & execution engine.

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { simulateCampaign } from "@/server/services/orchestrator.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/orchestrator/[id]/simulate">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await simulateCampaign(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
