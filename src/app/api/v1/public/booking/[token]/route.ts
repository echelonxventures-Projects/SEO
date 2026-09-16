// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { publicAgenda } from "@/server/services/temporal-booking.service";
import { publicBook } from "@/server/services/temporal-booking.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/booking/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "auth" },
    async () => {
      const data = await publicAgenda(token);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/booking/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "auth" },
    async ({ ip }) => {
      const data = await publicBook(token, await readJson(req), ip, req.headers.get("idempotency-key"));
      return ok(data ?? null);
    },
  );
}
