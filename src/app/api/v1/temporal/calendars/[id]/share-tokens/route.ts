// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listShareTokens } from "@/server/services/temporal-feed";
import { revokeShareTokens } from "@/server/services/temporal-feed";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]/share-tokens">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await listShareTokens(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/temporal/calendars/[id]/share-tokens">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await revokeShareTokens(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}
