// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { importCsv } from "@/server/services/audiences.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/audiences/[id]/import">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const csv = await req.text(); const data = await importCsv(ctxOf(viewer!, ip), id, csv);
      return ok(data ?? null);
    },
  );
}
