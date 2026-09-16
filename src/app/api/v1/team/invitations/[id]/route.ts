// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { revokeInvitation } from "@/server/services/org.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/team/invitations/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "member.invite" },
    async ({ viewer, ip }) => {
      await revokeInvitation(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
