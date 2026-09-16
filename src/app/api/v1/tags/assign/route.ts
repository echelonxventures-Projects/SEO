// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { attachTags } from "@/server/services/tags.service";
import { entityTypeSchema } from "@/server/services/tags.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "client.write" },
    async ({ viewer, ip }) => {
      const { entityType, entityId, tagIds } = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1), tagIds: z.array(z.string()).max(25) }).parse(await readJson(req)); await attachTags(ctxOf(viewer!, ip), entityType, entityId, tagIds);
      return ok(null);
    },
  );
}
