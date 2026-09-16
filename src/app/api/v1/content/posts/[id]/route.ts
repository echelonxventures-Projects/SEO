// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getPost } from "@/server/services/content.service";
import { updatePost } from "@/server/services/content.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/content/posts/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.read" },
    async ({ viewer, ip }) => {
      const data = await getPost(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/content/posts/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.write" },
    async ({ viewer, ip }) => {
      const data = await updatePost(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
