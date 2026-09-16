// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateMemberRole } from "@/server/services/org.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/team/members/[id]/role">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "member.update_role" },
    async ({ viewer, ip }) => {
      await updateMemberRole(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(null);
    },
  );
}
