// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { testEmailCampaign } from "@/server/services/email.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/email/campaigns/[id]/test">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "email.send" },
    async ({ viewer, ip }) => {
      await testEmailCampaign(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
