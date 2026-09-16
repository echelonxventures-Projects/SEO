// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { updateOrg } from "@/server/services/org.service";

export async function PATCH(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "org.update" },
    async ({ viewer, ip }) => {
      const data = await updateOrg(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
