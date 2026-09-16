// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { bookResource } from "@/server/services/temporal-resources.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/resources/[id]/book">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "resource.write", idempotent: true },
    async ({ viewer, ip }) => {
      const body = await readJson(req) as Record<string, unknown>; const data = await bookResource(ctxOf(viewer!, ip), { ...body, resourceId: id });
      return ok(data ?? null);
    },
  );
}
