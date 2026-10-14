// Orchestrator API — campaign composition & execution engine.
// Lifecycle transitions. The APPROVED transition additionally requires
// campaign.approve (separation of duty), enforced by the service.

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { transitionCampaign } from "@/server/services/orchestrator.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/orchestrator/[id]/transition">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const { to } = z
        .object({
          to: z.enum([
            "PLANNED",
            "PENDING_APPROVAL",
            "APPROVED",
            "LIVE",
            "CLOSED",
            "LEARNED",
          ]),
        })
        .parse(await readJson(req));
      await transitionCampaign(ctxOf(viewer!, ip), id, to);
      return ok(null);
    },
  );
}
