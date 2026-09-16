import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { verifyEmail } from "@/server/services/auth.service";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "verify");
    const body = await readBody(req);
    await verifyEmail(body);
    return ok({ verified: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
