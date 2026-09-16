// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { dashboardOverview } from "@/server/services/analytics.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "client.read" },
    async ({ viewer, ip }) => {
      const months = Number(req.nextUrl.searchParams.get("months") ?? 12); const data = await dashboardOverview(ctxOf(viewer!, ip), months);
      return ok(data ?? null);
    },
  );
}
