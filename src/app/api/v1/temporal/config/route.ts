// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { getTemporalConfig } from "@/server/services/temporal.service";
import { updateTemporalConfig } from "@/server/services/temporal.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await getTemporalConfig(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.write" },
    async ({ viewer, ip }) => {
      const data = await updateTemporalConfig(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
