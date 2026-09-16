// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listMeteredPrices } from "@/server/services/temporal-metering.service";
import { upsertMeteredPrice } from "@/server/services/temporal-metering.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const data = await listMeteredPrices(ctxOf(viewer!, ip));
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
      const data = await upsertMeteredPrice(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
