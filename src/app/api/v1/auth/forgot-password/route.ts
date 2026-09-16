import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok } from "@/server/serialize";
import { emailSchema } from "@/server/schemas";
import { forgotPassword } from "@/server/services/auth.service";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "forgot");
    const body = await readBody(req);
    const { email } = z.object({ email: emailSchema }).parse(body);
    await forgotPassword(email);
    return ok({ sent: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
