// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { studioRouting } from "@/server/services/studio.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const cap = (req.nextUrl.searchParams.get("capability") ?? "text") as "text" | "image" | "audio"; const data = await studioRouting(ctxOf(viewer!, ip), cap);
      return ok(data ?? null);
    },
  );
}
