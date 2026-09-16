// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getCampaignDetail } from "@/server/services/campaign.service";
import { updateCampaign } from "@/server/services/campaign.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/campaigns/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await getCampaignDetail(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/campaigns/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await updateCampaign(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
