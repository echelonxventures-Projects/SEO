import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { completeMfaLogin } from "@/server/services/auth.service";
import { setAuthCookies } from "@/server/sessions";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "mfa");
    const body = z
      .object({ token: z.string().min(10).max(600), code: z.string().min(4).max(20) })
      .parse(await readBody(req));
    const result = await completeMfaLogin(body.token, body.code, {
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    await setAuthCookies(
      result.session.token,
      result.session.csrf,
      result.session.expiresAt,
      result.activeOrgId,
    );
    return ok({ userId: result.userId });
  } catch (err) {
    return errorToResponse(err);
  }
}
