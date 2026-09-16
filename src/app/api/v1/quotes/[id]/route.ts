// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getQuote } from "@/server/services/sales.service";
import { deleteQuote } from "@/server/services/sales.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/quotes/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "quote.read" },
    async ({ viewer, ip }) => {
      const data = await getQuote(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/quotes/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "quote.delete" },
    async ({ viewer, ip }) => {
      await deleteQuote(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
