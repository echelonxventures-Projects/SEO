// Orchestrator API — campaign composition & execution engine.

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { learnCampaign } from "@/server/services/orchestrator.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/orchestrator/[id]/learn">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await learnCampaign(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
