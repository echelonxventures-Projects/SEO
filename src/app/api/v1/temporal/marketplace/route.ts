// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listListings } from "@/server/services/temporal-marketplace.service";
import { createListing } from "@/server/services/temporal-marketplace.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async ({ viewer, ip }) => {
      const data = await listListings(ctxOf(viewer!, ip), req.nextUrl.searchParams);
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
      const data = await createListing(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
