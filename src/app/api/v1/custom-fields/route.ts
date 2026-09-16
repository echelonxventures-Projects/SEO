// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listFieldDefs } from "@/server/services/customfields.service";
import { upsertFieldDef } from "@/server/services/customfields.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "settings.read" },
    async ({ viewer, ip }) => {
      const data = await listFieldDefs(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("entity") ?? "CLIENT");
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
      const data = await upsertFieldDef(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
