// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { tagsFor } from "@/server/services/tags.service";
import { entityTypeSchema } from "@/server/services/tags.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "org.read" },
    async ({ viewer, ip }) => {
      const t = entityTypeSchema.parse(req.nextUrl.searchParams.get("entityType")); const id = req.nextUrl.searchParams.get("entityId") ?? ""; const data = await tagsFor(ctxOf(viewer!, ip), t, id);
      return ok(data ?? null);
    },
  );
}
