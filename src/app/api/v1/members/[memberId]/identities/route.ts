// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listMemberIdentities } from "@/server/services/audiences.service";
import { addIdentity } from "@/server/services/audiences.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/members/[memberId]/identities">,
): Promise<Response> {
  const { memberId } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await listMemberIdentities(ctxOf(viewer!, ip), memberId);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/members/[memberId]/identities">,
): Promise<Response> {
  const { memberId } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await addIdentity(ctxOf(viewer!, ip), memberId, await readJson(req));
      return ok(data ?? null);
    },
  );
}
