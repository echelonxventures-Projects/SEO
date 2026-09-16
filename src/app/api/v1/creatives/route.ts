// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listAdCreatives } from "@/server/services/studio.service";
import { createAdCreative } from "@/server/services/studio.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const cid = req.nextUrl.searchParams.get("campaignId") ?? undefined; const data = await listAdCreatives(ctxOf(viewer!, ip), cid);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await createAdCreative(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
