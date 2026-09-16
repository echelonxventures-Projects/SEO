// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listSubscribers } from "@/server/services/email.service";
import { addSubscriber } from "@/server/services/email.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/email/lists/[id]/subscribers">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "email.read" },
    async ({ viewer, ip }) => {
      const data = await listSubscribers(ctxOf(viewer!, ip), id);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/email/lists/[id]/subscribers">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "email.write" },
    async ({ viewer, ip }) => {
      const data = await addSubscriber(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
