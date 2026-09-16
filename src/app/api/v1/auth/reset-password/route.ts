import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { resetPassword } from "@/server/services/auth.service";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "reset");
    const body = await readBody(req);
    await resetPassword(body, clientIp(req.headers));
    return ok({ reset: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
