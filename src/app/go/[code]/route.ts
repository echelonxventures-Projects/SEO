import type { NextRequest } from "next/server";
import { resolveAndCount } from "@/server/services/links.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/go/[code]">): Promise<Response> {
  const { code } = await ctx.params;
  const destination = await resolveAndCount(code);
  if (!destination) {
    return new Response("Link not found", { status: 404 });
  }
  return Response.redirect(destination, 302);
}
