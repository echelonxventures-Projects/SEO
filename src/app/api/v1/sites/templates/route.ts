// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listTemplates } from "@/server/services/sites.service";
import { upsertTemplate } from "@/server/services/sites.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "site.read" },
    async ({ viewer, ip }) => {
      const data = await listTemplates(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "site.write" },
    async ({ viewer, ip }) => {
      const data = await upsertTemplate(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
