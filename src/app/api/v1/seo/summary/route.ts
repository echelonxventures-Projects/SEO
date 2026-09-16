// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { seoSummary } from "@/server/services/seo.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "seo.read" },
    async ({ viewer, ip }) => {
      const data = await seoSummary(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}
