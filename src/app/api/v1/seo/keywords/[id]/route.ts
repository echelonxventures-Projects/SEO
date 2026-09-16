// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deleteKeyword } from "@/server/services/seo.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/seo/keywords/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "seo.write" },
    async ({ viewer, ip }) => {
      await deleteKeyword(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
