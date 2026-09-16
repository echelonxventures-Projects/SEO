// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { resolveStrings } from "@/server/services/temporal-branding.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "org.read" },
    async ({ viewer, ip }) => {
      const data = await resolveStrings(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("code") ?? undefined);
      return ok(data ?? null);
    },
  );
}
