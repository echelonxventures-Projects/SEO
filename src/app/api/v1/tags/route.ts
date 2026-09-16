// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listTags } from "@/server/services/tags.service";
import { upsertTag } from "@/server/services/tags.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "org.read" },
    async ({ viewer, ip }) => {
      const data = await listTags(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "client.write" },
    async ({ viewer, ip }) => {
      const data = await upsertTag(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
