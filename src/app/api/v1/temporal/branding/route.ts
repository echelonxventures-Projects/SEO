// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getBranding } from "@/server/services/temporal-branding.service";
import { upsertBranding } from "@/server/services/temporal-branding.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const data = await getBranding(ctxOf(viewer!, ip));
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
      const data = await upsertBranding(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
