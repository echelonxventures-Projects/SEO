// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { activeSchema } from "@/server/schemas";
import { setTaxRateActive } from "@/server/services/settings.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/settings/tax-rates/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      const { active } = activeSchema.parse(await readJson(req)); const data = await setTaxRateActive(ctxOf(viewer!, ip), id, active);
      return ok(data ?? null);
    },
  );
}
