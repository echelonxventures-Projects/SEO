// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { settleByCheckoutToken } from "@/server/services/billing.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/pay/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "auth" },
    async ({ ip }) => {
      const data = await settleByCheckoutToken(token, ip);
      return ok(data ?? null);
    },
  );
}
