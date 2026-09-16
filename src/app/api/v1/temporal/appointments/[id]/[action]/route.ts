// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { transitionAppointment } from "@/server/services/temporal-booking.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/appointments/[id]/[action]">,
): Promise<Response> {
  const { id, action } = await ctx.params;
  return route(
    req,
    { permission: "appointment.book" },
    async ({ viewer, ip }) => {
      const { action: verb, reason } = z.object({ action: z.enum(["confirm", "cancel", "checkIn", "complete", "noShow"]), reason: z.string().max(200).optional() }).parse({ action, ...((await readJson(req)) as object) }); const data = await transitionAppointment(ctxOf(viewer!, ip), id, verb, reason);
      return ok(data ?? null);
    },
  );
}
