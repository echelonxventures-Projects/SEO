// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getProject } from "@/server/services/delivery.service";
import { updateProject } from "@/server/services/delivery.service";
import { deleteProject } from "@/server/services/delivery.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/projects/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "project.read" },
    async ({ viewer, ip }) => {
      const data = await getProject(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/projects/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "project.write" },
    async ({ viewer, ip }) => {
      const data = await updateProject(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/projects/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "project.delete" },
    async ({ viewer, ip }) => {
      await deleteProject(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
