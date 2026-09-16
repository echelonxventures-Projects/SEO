// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { availabilityPreview } from "@/server/services/temporal-resources.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "resource.read" },
    async ({ viewer, ip }) => {
      const q = req.nextUrl.searchParams; const data = await availabilityPreview(ctxOf(viewer!, ip), q.get("subjectType") ?? "USER", q.get("subjectId") ?? viewer!.userId, q);
      return ok(data ?? null);
    },
  );
}
