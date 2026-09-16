// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { removeMember } from "@/server/services/org.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/team/members/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "member.remove" },
    async ({ viewer, ip }) => {
      await removeMember(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
