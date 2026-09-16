// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { upsertTemplate } from "@/server/services/sites.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/sites/templates/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "site.write" },
    async ({ viewer, ip }) => {
      const body = await readJson(req); const { placement, ...rest } = body as Record<string, unknown>; void placement; const data = await upsertTemplate(ctxOf(viewer!, ip), body, id);
      return ok(data ?? null);
    },
  );
}
