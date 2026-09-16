// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { listPublishedPlans } from "@/server/services/billing.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public" },
    async () => {
      const data = await listPublishedPlans();
      return ok(data ?? null);
    },
  );
}
