// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { publishNow } from "@/server/services/content.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/content/posts/[id]/publish-now">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.publish" },
    async ({ viewer, ip }) => {
      await publishNow(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
