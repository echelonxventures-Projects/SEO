// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listEventsApi } from "@/server/services/events-api";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "activity.read" },
    async ({ viewer, ip }) => {
      const data = await listEventsApi(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("type") ?? undefined);
      return ok(data ?? null);
    },
  );
}
