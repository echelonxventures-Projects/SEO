// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getHolidays } from "@/server/services/temporal-library.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/holidays/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const y = req.nextUrl.searchParams.get("year"); const data = await getHolidays(ctxOf(viewer!, ip), id, y ? Number(y) : undefined);
      return ok(data ?? null);
    },
  );
}
