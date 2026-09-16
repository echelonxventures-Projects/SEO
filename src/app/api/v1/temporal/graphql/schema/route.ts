// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { graphqlSchemaDoc } from "@/server/services/temporal-sdk.service";

export async function GET(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "temporal.read" },
    async () => {
      const data = await graphqlSchemaDoc();
      return ok(data ?? null);
    },
  );
}
