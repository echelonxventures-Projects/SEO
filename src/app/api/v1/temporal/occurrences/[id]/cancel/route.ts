// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { cancelOccurrence } from "@/server/services/temporal.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/occurrences/[id]/cancel">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const body = await readJson(req).catch(() => ({})); const data = await cancelOccurrence(ctxOf(viewer!, ip), id, (body as { reason?: string }).reason);
      return ok(data ?? null);
    },
  );
}
