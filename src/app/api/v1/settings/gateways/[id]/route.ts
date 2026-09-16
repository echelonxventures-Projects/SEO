// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deleteGatewayConfig } from "@/server/services/billing.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/settings/gateways/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      await deleteGatewayConfig(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
