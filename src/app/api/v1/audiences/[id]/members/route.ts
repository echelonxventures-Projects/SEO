// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().

import { route } from "@/server/api";
import { readJson } from "@/server/api";
import { ok } from "@/server/serialize";
import { ctxOf } from "@/server/services/common";
import type { NextRequest } from "next/server";
import { listMembers } from "@/server/services/audiences.service";
import { addMember } from "@/server/services/audiences.service";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/audiences/[id]/members">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.read" },
    async ({ viewer, ip }) => {
      const data = await listMembers(ctxOf(viewer!, ip), id, req.nextUrl.searchParams);
      return ok(data ?? null);
    },
  );
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/audiences/[id]/members">,
): Promise<Response> {
  const { id } = await ctx.params;
  return route(
    req,
    { permission: "campaign.write" },
    async ({ viewer, ip }) => {
      const data = await addMember(ctxOf(viewer!, ip), id, await readJson(req));
      return ok(data ?? null);
    },
  );
}
