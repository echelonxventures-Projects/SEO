// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { registryDoc } from "@/server/services/events-api";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public" },
    async () => {
      const data = await registryDoc();
      return ok(data ?? null);
    },
  );
}
