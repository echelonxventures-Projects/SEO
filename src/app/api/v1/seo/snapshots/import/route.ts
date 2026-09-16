// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { importRankCsv } from "@/server/services/seo.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { permission: "seo.write" },
    async ({ viewer, ip }) => {
      const csv = await req.text(); const data = await importRankCsv(ctxOf(viewer!, ip), csv);
      return ok(data ?? null);
    },
  );
}
