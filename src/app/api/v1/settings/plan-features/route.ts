// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { listPlanFeatureCatalog } from "@/server/services/settings.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async () => {
      const data = await listPlanFeatureCatalog();
      return ok(data ?? null);
    },
  );
}
