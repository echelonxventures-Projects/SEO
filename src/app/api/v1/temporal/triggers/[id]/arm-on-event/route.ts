// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { armEventTrigger } from "@/server/services/temporal-triggers.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/triggers/[id]/arm-on-event">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const body = await readJson(req) as { eventId: string }; const data = await armEventTrigger(ctxOf(viewer!, ip), id, body.eventId);
      return ok(data ?? null);
    },
  );
}
