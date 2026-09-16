// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listLinks } from "@/server/services/links.service";
import { createLink } from "@/server/services/links.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "link.read" },
    async ({ viewer, ip }) => {
      const data = await listLinks(ctxOf(viewer!, ip));
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "link.write" },
    async ({ viewer, ip }) => {
      const data = await createLink(ctxOf(viewer!, ip), await readJson(req));
      return ok(data ?? null);
    },
  );
}
