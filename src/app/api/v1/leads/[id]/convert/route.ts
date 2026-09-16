// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { convertLead } from "@/server/services/crm.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/leads/[id]/convert">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "lead.convert" },
    async ({ viewer, ip }) => {
      const data = await convertLead(ctxOf(viewer!, ip), id, await readJson(req).catch(() => ({})));
      return ok(data ?? null);
    },
  );
}
