// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { previewPattern } from "@/server/services/temporal.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/patterns/[id]/preview">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const q = req.nextUrl.searchParams; const data = await previewPattern(ctxOf(viewer!, ip), id, q.get("from") ?? undefined, q.get("days") ? Number(q.get("days")) : undefined, q.get("max") ? Number(q.get("max")) : undefined);
      return ok(data ?? null);
    },
  );
}
