// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { activeSchema } from "@/server/schemas";
import { toggleTemplate } from "@/server/services/sites.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/sites/templates/[id]/toggle">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "site.write" },
    async ({ viewer, ip }) => {
      const { active } = activeSchema.parse(await readJson(req)); await toggleTemplate(ctxOf(viewer!, ip), id, active);
      return ok(null);
    },
  );
}
