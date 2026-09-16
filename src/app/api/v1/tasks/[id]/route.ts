// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateTask } from "@/server/services/delivery.service";
import { deleteTask } from "@/server/services/delivery.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/tasks/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "task.write" },
    async ({ viewer, ip }) => {
      const data = await updateTask(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/tasks/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "task.delete" },
    async ({ viewer, ip }) => {
      await deleteTask(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
