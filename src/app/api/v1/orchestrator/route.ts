// Orchestrator API — campaign composition & execution engine.
// Mirrors /api/v1/campaigns so the registry contract (/api/v1/orchestrator/*) resolves.

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listCampaigns } from "@/server/services/campaign.service";
import { createCampaign } from "@/server/services/campaign.service";

export async function GET(req: NextRequest): Promise<Response> {
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await listCampaigns(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await createCampaign(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
