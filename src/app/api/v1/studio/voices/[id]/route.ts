// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { upsertVoice } from "@/server/services/studio.service";
import { deleteVoice } from "@/server/services/studio.service";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/studio/voices/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.write" },
    async ({ viewer, ip }) => {
      const data = await upsertVoice(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/studio/voices/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.write" },
    async ({ viewer, ip }) => {
      await deleteVoice(ctxOf(viewer!, ip), id);
      return ok(null);
    },
  );
}
