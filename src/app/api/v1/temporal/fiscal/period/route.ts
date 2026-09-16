// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { fiscalPeriodOf } from "@/server/services/temporal-library.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const q = req.nextUrl.searchParams; const data = await fiscalPeriodOf(ctxOf(viewer!, ip), q.get("code") ?? "", q.get("at") ?? new Date().toISOString());
      return ok(data ?? null);
    },
  );
}
