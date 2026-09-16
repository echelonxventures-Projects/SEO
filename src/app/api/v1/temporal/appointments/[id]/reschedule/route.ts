// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { reschedule } from "@/server/services/temporal-booking.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/appointments/[id]/reschedule">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "appointment.book" },
    async ({ viewer, ip }) => {
      const body = await readJson(req) as { slotId: string }; const data = await reschedule(ctxOf(viewer!, ip), id, body.slotId);
      return ok(data ?? null);
    },
  );
}
