// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { runEmailDispatcher } from "@/server/services/email.service";

export async function POST(
  req: NextRequest,
): Promise<Response> {
  return route(
    req,
    { auth: "public", rate: "api" },
    async () => {
      const { assertCronSecret, stampCron } = await import("@/server/cron"); assertCronSecret(req); const data = await runEmailDispatcher(); await stampCron("email-dispatch");
      return ok(data ?? null);
    },
  );
}
