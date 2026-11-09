// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { governanceSweep } from "@/server/services/temporal-library.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public", rate: "api" },
    async () => {
      const { assertCronSecret } = await import("@/server/cron"); assertCronSecret(req); const data = await governanceSweep();
      return ok(data ?? null);
    },
  );
}
