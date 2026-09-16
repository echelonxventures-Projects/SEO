import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { readiness } from "@/server/services/readiness.service";

export const dynamic = "force-dynamic";

/** Platform-wide production-readiness checklist (external blanks audit). */
export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { permission: "settings.read" }, async () => {
    const data = await readiness();
    return ok(data);
  });
}
