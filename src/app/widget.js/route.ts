// Embeddable widget loader — injects an iframe for the token's embed page.
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const origin = getEnv().APP_URL;
  const js = `(function(){
  var s = document.currentScript || (function(){var a=document.getElementsByTagName("script");return a[a.length-1];})();
  var token = (s && s.getAttribute("data-token")) || ${JSON.stringify(token)};
  if (!token) return;
  var host = document.getElementById("omnimark-widget");
  var f = document.createElement("iframe");
  f.src = ${JSON.stringify(origin)} + "/embed/" + encodeURIComponent(token);
  f.style.width = "100%";
  f.style.minHeight = "520px";
  f.style.border = "0";
  f.setAttribute("loading", "lazy");
  f.setAttribute("title", "OmniMark widget");
  (host || document.body).appendChild(f);
})();`;
  return new Response(js, { status: 200, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" } });
}
