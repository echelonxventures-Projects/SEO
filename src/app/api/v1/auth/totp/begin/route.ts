import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { beginTotpSetup } from "@/server/services/auth.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const data = await beginTotpSetup(viewer!.userId);
    return ok(data);
  });
}
