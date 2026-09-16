// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { moveOccurrence } from "@/server/services/temporal.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/occurrences/[id]/move">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const body = await readJson(req) as { startsAt: string; endsAt?: string }; const data = await moveOccurrence(ctxOf(viewer!, ip), id, body.startsAt, body.endsAt);
      return ok(data ?? null);
    },
  );
}
