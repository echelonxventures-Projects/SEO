// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listServiceItems } from "@/server/services/sales.service";
import { createServiceItem } from "@/server/services/sales.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "catalog.read" },
    async ({ viewer, ip }) => {
      const data = await listServiceItems(ctxOf(viewer!, ip), req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "catalog.write" },
    async ({ viewer, ip }) => {
      const data = await createServiceItem(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
