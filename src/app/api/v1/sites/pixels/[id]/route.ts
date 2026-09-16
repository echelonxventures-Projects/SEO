// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { activeSchema } from "@/server/schemas";
import { togglePixel } from "@/server/services/sites.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/sites/pixels/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "site.write" },
    async ({ viewer, ip }) => {
      const { active } = activeSchema.parse(await readJson(req)); const data = await togglePixel(ctxOf(viewer!, ip), id, active);
      return ok(data ?? null);
    },
  );
}
