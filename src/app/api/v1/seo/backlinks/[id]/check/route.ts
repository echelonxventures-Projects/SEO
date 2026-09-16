// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { checkBacklink } from "@/server/services/seo.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/seo/backlinks/[id]/check">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "seo.write" },
    async ({ viewer, ip }) => {
      const data = await checkBacklink(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
