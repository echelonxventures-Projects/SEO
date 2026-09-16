// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getAudience } from "@/server/services/audiences.service";
import { archiveAudience } from "@/server/services/audiences.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/audiences/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await getAudience(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/audiences/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      await archiveAudience(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
