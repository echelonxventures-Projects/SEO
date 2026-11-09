import type { NextRequest } from "next/server";
import { errorToResponse } from "@/server/errors";
import { completeConnect } from "@/server/services/social.service";
import { resolveViewer } from "@/server/context";

export const dynamic = "force-dynamic";

/** OAuth callback: the state token is the CSRF capability (short-lived, single-use). */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const state = req.nextUrl.searchParams.get("state") ?? "";
    const code = req.nextUrl.searchParams.get("code") ?? "";
    const err = req.nextUrl.searchParams.get("error");
    if (err || !state || !code) {
      return Response.redirect(`${process.env.APP_URL ?? ""}/social?error=denied`, 302);
    }
    const viewer = await resolveViewer(req.headers);
    await completeConnect(decodeURIComponent(state), code, viewer?.userId ?? null);
    return Response.redirect(`${process.env.APP_URL ?? ""}/social?connected=1`, 302);
  } catch (e) {
    return errorToResponse(e);
  }
}
