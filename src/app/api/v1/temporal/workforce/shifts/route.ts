// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listShifts } from "@/server/services/temporal-resources.service";
import { createShift } from "@/server/services/temporal-resources.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "workforce.read" },
    async ({ viewer, ip }) => {
      const data = await listShifts(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "workforce.write" },
    async ({ viewer, ip }) => {
      const data = await createShift(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
