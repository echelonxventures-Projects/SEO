// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deactivateGatewayConfig } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/settings/gateways/[id]/deactivate">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      await deactivateGatewayConfig(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
