// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateStage } from "@/server/services/settings.service";
import { deleteStage } from "@/server/services/settings.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/settings/stages/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      const data = await updateStage(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/settings/stages/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      await deleteStage(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
