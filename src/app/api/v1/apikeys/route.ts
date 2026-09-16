// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listApiKeys } from "@/server/services/org.service";
import { createApiKey } from "@/server/services/org.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "apikey.read" },
    async ({ viewer, ip }) => {
      const data = await listApiKeys(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "apikey.manage" },
    async ({ viewer, ip }) => {
      const data = await createApiKey(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
