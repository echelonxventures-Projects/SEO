// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { agenda } from "@/server/services/temporal.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await agenda(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}
