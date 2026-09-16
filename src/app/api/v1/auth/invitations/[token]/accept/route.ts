import type { NextRequest } from "next/server";
import { ok } from "@/server/serialize";
import { clientIp } from "@/server/audit";
import { acceptInvitation } from "@/server/services/auth.service";
import { setAuthCookies } from "@/server/sessions";
import { authGuard, errorToResponse, readBody } from "../../../_guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/auth/invitations/[token]/accept">,
): Promise<Response> {
  try {
    await authGuard(req, "invite");
    const { token } = await ctx.params;
    const body = (await readBody(req)) as { name?: string; password: string };
    const result = await acceptInvitation(decodeURIComponent(token), body, {
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
