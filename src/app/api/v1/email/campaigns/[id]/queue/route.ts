// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { queueSend } from "@/server/services/email.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/email/campaigns/[id]/queue">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "email.send" },
    async ({ viewer, ip }) => {
      const body = await readJson(req); await queueSend(ctxOf(viewer!, ip), id, (body as { scheduledAt?: string } | null)?.scheduledAt ?? null);
      return ok(null);
    },
  );
}
