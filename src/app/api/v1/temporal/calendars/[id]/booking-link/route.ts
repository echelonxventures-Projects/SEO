// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { createBookingLink } from "@/server/services/temporal-booking.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]/booking-link">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "appointment.manage" },
    async ({ viewer, ip }) => {
      const data = await createBookingLink(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
