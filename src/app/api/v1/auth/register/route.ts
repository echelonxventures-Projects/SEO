import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { register } from "@/server/services/auth.service";
import { setAuthCookies } from "@/server/sessions";
import { authGuard, errorToResponse, readBody } from "../_guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await authGuard(req, "register");
    const body = await readBody(req);
    const result = await register(body, {
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    await setAuthCookies(
      result.session.token,
      result.session.csrf,
      result.session.expiresAt,
      result.orgId,
    );
    return ok({ userId: result.userId, orgId: result.orgId });
  } catch (err) {
    return errorToResponse(err);
  }
}
