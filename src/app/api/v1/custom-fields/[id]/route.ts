// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deactivateFieldDef } from "@/server/services/customfields.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/custom-fields/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      await deactivateFieldDef(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
