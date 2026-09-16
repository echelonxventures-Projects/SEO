// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { runDueReports } from "@/server/services/analytics.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public", rate: "auth" },
    async () => {
      const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runDueReports();
      return ok(data ?? null);
    },
  );
}
