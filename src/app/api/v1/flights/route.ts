// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listFlights } from "@/server/services/calendar.service";
import { createFlight } from "@/server/services/calendar.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const cid = req.nextUrl.searchParams.get("campaignId") ?? undefined; const data = await listFlights(ctxOf(viewer!, ip), cid);
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
      const data = await createFlight(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
