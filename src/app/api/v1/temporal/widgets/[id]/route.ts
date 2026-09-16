// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateWidget } from "@/server/services/temporal-widgets.service";
import { deleteWidget } from "@/server/services/temporal-widgets.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/widgets/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await updateWidget(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/widgets/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await deleteWidget(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
