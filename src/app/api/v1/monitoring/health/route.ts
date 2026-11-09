// Operational monitoring — Bearer $CRON_SECRET (same secret as the scheduler).

import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import type { NextRequest } from "next/server";
import { assertCronSecret } from "@/server/cron";
import { healthReport } from "@/server/services/monitoring.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { auth: "public", rate: "api" }, async () => {
    assertCronSecret(req);
    return ok(await healthReport());
  });
}
