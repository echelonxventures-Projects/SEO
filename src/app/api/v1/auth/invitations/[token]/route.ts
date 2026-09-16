import type { NextRequest } from "next/server";
import { errorToResponse } from "@/server/errors";
import { ok } from "@/server/serialize";
import { db } from "@/server/db";
import { verifyToken } from "@/server/tokens";
import { AppError, ErrorCodes } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Public invitation details for the accept page (no secrets revealed). */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/v1/auth/invitations/[token]">,
): Promise<Response> {
  try {
    const { token } = await ctx.params;
    const payload = verifyToken("invitation", decodeURIComponent(token));
    const invitation = await db.invitation.findUnique({
      where: { id: payload.s },
      include: { org: { select: { name: true } }, invitedBy: { select: { name: true } } },
    });
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
      throw new AppError(ErrorCodes.FORBIDDEN, "This invitation is no longer valid");
    }
    const role = await db.role.findUnique({ where: { code: invitation.roleCode } });
    return ok({
      orgName: invitation.org.name,
      email: invitation.email,
      roleName: role?.name ?? invitation.roleCode,
      invitedBy: invitation.invitedBy.name,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
