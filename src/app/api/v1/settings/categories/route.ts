// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { categoryListSchema } from "@/server/schemas";
import { listCategories } from "@/server/services/settings.service";
import { createCategory } from "@/server/services/settings.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const { kind } = categoryListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)); const data = await listCategories(ctxOf(viewer!, ip), kind);
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
      const data = await createCategory(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
