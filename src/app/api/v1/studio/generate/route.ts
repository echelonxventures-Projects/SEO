// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { createGenerationJob } from "@/server/services/studio.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "content.write", idempotent: true },
    async ({ viewer, ip }) => {
      const data = await createGenerationJob(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
