// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { activeSchema } from "@/server/schemas";
import { toggleSubApi } from "@/server/services/events-api";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/events/subscriptions/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      const { active } = activeSchema.parse(await readJson(req)); await toggleSubApi(ctxOf(viewer!, ip), id, !active);
      return ok(null);
    },
  );
}
