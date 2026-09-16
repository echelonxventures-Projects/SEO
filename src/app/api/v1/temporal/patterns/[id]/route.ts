// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getPattern } from "@/server/services/temporal.service";
import { updatePattern } from "@/server/services/temporal.service";
import { deletePattern } from "@/server/services/temporal.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/patterns/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await getPattern(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/patterns/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await updatePattern(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/patterns/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await deletePattern(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
