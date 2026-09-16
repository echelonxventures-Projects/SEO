import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  return route(req, { auth: "required" }, async ({ viewer }) => {
    const v = viewer!;
    const user = await db.user.findUniqueOrThrow({
      where: { id: v.userId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true, isPlatformAdmin: true },
    });
    return ok({
      user,
      authKind: v.authKind,
      orgs: v.orgs,
      active: v.active
        ? {
            orgId: v.active.orgId,
            orgName: v.active.orgName,
            orgStatus: v.active.orgStatus,
            roleCode: v.active.roleCode,
            permissions: [...v.active.permissions].sort(),
          }
        : null,
    });
  });
}
