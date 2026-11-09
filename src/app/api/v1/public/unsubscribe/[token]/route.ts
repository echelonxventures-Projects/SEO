// RFC 8058 one-click unsubscribe. Mail clients (Gmail, Yahoo, Apple Mail) POST
// `List-Unsubscribe=One-Click` here from the List-Unsubscribe header. The
// signed token is the credential; there is no session or CSRF token.

import type { NextRequest } from "next/server";
import { route } from "@/server/api";
import { ok } from "@/server/serialize";
import { unsubscribe } from "@/server/services/email.service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/v1/public/unsubscribe/[token]">,
): Promise<Response> {
  const { token } = await ctx.params;
  return route(req, { auth: "public", rate: "auth" }, async () => {
    await unsubscribe(decodeURIComponent(token));
    return ok({ unsubscribed: true });
  });
}
