// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { resourceConflicts } from "@/server/services/temporal-resources.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/resources/[id]/conflicts">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "resource.read" },
    async ({ viewer, ip }) => {
      const q = req.nextUrl.searchParams; const data = await resourceConflicts(ctxOf(viewer!, ip), id, q.get("from") ?? undefined, q.get("to") ?? undefined);
      return ok(data ?? null);
    },
  );
}
