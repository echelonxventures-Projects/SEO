import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { AppError, ErrorCodes } from "@/server/errors";
import { getEnv } from "@/server/env";
import { ORG_COOKIE } from "@/server/sessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/auth/org/switch/[orgId]">,
): Promise<Response> {
  const { orgId } = await ctx.params;
  return route(req, { auth: "required" }, async ({ viewer }) => {
    if (!viewer!.orgs.some((o) => o.orgId === orgId)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "You are not a member of that workspace");
    }
    const store = await cookies();
    store.set(ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: getEnv().IS_PRODUCTION,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return ok({ orgId });
  });
}
