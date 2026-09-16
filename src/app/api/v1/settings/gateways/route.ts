// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listGatewayConfigs } from "@/server/services/billing.service";
import { upsertGatewayConfig } from "@/server/services/billing.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const data = await listGatewayConfigs(ctxOf(viewer!, ip), viewer!.isPlatformAdmin);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.manage" },
    async ({ viewer, ip }) => {
      const data = await upsertGatewayConfig(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
