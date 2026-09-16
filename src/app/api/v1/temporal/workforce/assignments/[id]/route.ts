// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { deleteAssignment } from "@/server/services/temporal-resources.service";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/workforce/assignments/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "workforce.write" },
    async ({ viewer, ip }) => {
      await deleteAssignment(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
