// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { moveStage } from "@/server/services/content.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/content/posts/[id]/stage">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "content.write" },
    async ({ viewer, ip }) => {
      const { to } = z.object({ to: z.enum(["IDEATION","RESEARCH","PLANNING","CREATION","REVIEW","APPROVED","PUBLISHING","PUBLISHED","OPTIMIZING","ARCHIVED"]) }).parse(await readJson(req)); const data = await moveStage(ctxOf(viewer!, ip), id, to);
      return ok(data ?? null);
    },
  );
}
