// Hand-written public ICS feed — auth-free but REVOCABLE (token registry check).

import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { publicFeedIcs } from "@/server/services/temporal-feed";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/feed/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(req, { auth: "public", rate: "api" }, async () => {
    const ics = await publicFeedIcs(decodeURIComponent(token));
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": 'inline; filename="calendar.ics"',
      },
    });
  });
}
