// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { publicBranding } from "@/server/services/temporal-branding.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public", rate: "api" },
    async () => {
      const data = await publicBranding(req.nextUrl.searchParams.get("domain") ?? new URL(req.url).hostname);
      return ok(data ?? null);
    },
  );
}
