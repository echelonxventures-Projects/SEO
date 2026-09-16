// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listLists } from "@/server/services/email.service";
import { createList } from "@/server/services/email.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "email.read" },
    async ({ viewer, ip }) => {
      const data = await listLists(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "email.write" },
    async ({ viewer, ip }) => {
      const data = await createList(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
