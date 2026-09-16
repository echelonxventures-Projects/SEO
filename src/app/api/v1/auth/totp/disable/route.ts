import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { disableTotp } from "@/server/services/auth.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await readJson(req));
    await disableTotp(viewer!.userId, password);
    return ok(null);
  });
}
