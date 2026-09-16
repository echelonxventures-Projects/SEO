// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { decideQuote } from "@/server/services/sales.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/quotes/[id]/decision">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "quote.approve" },
    async ({ viewer, ip }) => {
      const data = await decideQuote(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
