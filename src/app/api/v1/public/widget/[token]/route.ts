// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { publicWidget } from "@/server/services/temporal-widgets.service";
import { publicWidgetBook } from "@/server/services/temporal-widgets.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/widget/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "api" },
    async () => {
      const data = await publicWidget(token, req.headers.get("origin"));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/widget/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(
    req,
    { auth: "public", rate: "api" },
    async ({ ip }) => {
      const data = await publicWidgetBook(token, await readJson(req), ip);
      return ok(data ?? null);
    },
  );
}
