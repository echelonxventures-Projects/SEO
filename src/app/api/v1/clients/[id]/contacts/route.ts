// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { createContact } from "@/server/services/crm.service";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/clients/[id]/contacts">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "client.write" },
    async ({ viewer, ip }) => {
      const data = await createContact(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
