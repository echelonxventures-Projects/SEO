// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { dslStudio } from "@/server/services/temporal.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async () => {
      const data = await dslStudio(await readJson(req));
      return ok(data ?? null);
    },
  );
}
