import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const PALETTES = [
  ["#6366f1", "#22d3ee"],
  ["#f43f5e", "#fb923c"],
  ["#10b981", "#a3e635"],
  ["#8b5cf6", "#ec4899"],
];

/** Deterministic branded SVG poster for the demo image provider. */
export async function GET(req: import("next/server").NextRequest, ctx: RouteContext<"/api/v1/public/ai/demo-image/[token]">): Promise<Response> {
  const { token } = await ctx.params;
  const prompt = req.nextUrl.searchParams.get("p") ?? "";
  const h = createHash("sha256").update(token + prompt).digest();
  const [a, b] = PALETTES[h[0] % PALETTES.length];
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const words = prompt.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 8);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 18) { lines.push(cur.trim()); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  const text = lines.slice(0, 4);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="1536" height="1024" fill="url(#g)"/>` +
    `<circle cx="${300 + (h[1] % 900)}" cy="${200 + (h[2] % 600)}" r="${140 + (h[3] % 200)}" fill="rgba(255,255,255,0.12)"/>` +
    `<rect x="0" y="760" width="1536" height="264" fill="rgba(9,9,11,0.72)"/>` +
    text.map((t, i) =>
      `<text x="80" y="${828 + i * 52}" font-family="system-ui,sans-serif" font-weight="700" font-size="42" fill="#fafafa">${esc(t)}</text>`,
    ).join("") +
    `<text x="80" y="996" font-family="system-ui,sans-serif" font-size="20" fill="rgba(250,250,250,0.6)">DEMO studio render · OmniMark</text></svg>`;
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
}
