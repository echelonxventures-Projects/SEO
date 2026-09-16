import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { confirmTotpSetup } from "@/server/services/auth.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const { code } = z.object({ code: z.string().min(4).max(20) }).parse(await readJson(req));
    const data = await confirmTotpSetup(viewer!.userId, code);
    return ok(data);
  });
}
