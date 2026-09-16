// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getCalendar } from "@/server/services/temporal.service";
import { updateCalendar } from "@/server/services/temporal.service";
import { archiveCalendar } from "@/server/services/temporal.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await getCalendar(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await updateCalendar(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await archiveCalendar(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
