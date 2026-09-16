// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { processWebhook } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/webhooks/[provider]">,
): Promise<Response> {
  const { provider } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "api" },
    async () => {
      const raw = await req.text(); const result = await processWebhook(provider, raw, req.headers); const data = result;
      return ok(result ?? null);
    },
  );
}
