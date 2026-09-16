// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { transitionOffer } from "@/server/services/offers.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/offers/[id]/status">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const { status } = z.object({ status: z.enum(["DRAFT","PENDING_APPROVAL","APPROVED","PUBLISHED","ACTIVE","EXPIRED","ARCHIVED"]) }).parse(await readJson(req)); const data = await transitionOffer(ctxOf(viewer!, ip), id, status);
      return ok(data ?? null);
    },
  );
}
