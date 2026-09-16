import { markOpened } from "@/server/services/email.service";

export const dynamic = "force-dynamic";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export async function GET(_req: import("next/server").NextRequest, ctx: RouteContext<"/api/v1/public/email/open/[sendId]">): Promise<Response> {
  const { sendId } = await ctx.params;
  try {
    await markOpened(sendId);
  } catch {
    /* tracking pixel never fails */
  }
  return new Response(PNG_1X1, {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store, max-age=0",
    },
  });
}
