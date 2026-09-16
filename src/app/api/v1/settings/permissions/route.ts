// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { listPermissionsCatalog } from "@/server/services/org.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "member.read" },
    async () => {
      const data = await listPermissionsCatalog();
      return ok(data ?? null);
    },
  );
}
