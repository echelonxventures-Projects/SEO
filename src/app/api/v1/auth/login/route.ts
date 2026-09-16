import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { login } from "@/server/services/auth.service";
import { setAuthCookies } from "@/server/sessions";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "login");
    const body = await readBody(req);
    const result = await login(body, {
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    if (result.mfaRequired) {
      return Response.json({ data: { mfaRequired: true }, meta: { token: result.mfaToken } }, { status: 200 });
    }
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
