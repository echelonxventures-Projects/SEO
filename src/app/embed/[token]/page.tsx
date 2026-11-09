import { headers } from "next/headers";
import { getEnv } from "@/server/env";
import { publicWidget } from "@/server/services/temporal-widgets.service";
import { EmbedClient } from "./embed-client";

export const metadata = { title: "Book a time" };
export const dynamic = "force-dynamic";

/**
 * Origin of the page embedding this iframe, from the Referer the browser
 * sends for the iframe navigation (origin-only under the default
 * strict-origin-when-cross-origin policy). Returns `undefined` when opened
 * from our own app (previews), `null` when unknown — which fails closed for
 * widgets that have an origin allowlist.
 */
async function embedderOrigin(): Promise<string | null | undefined> {
  const h = await headers();
  const referer = h.get("referer");
  if (!referer) return null;
  try {
    const origin = new URL(referer).origin;
    return origin === new URL(getEnv().APP_URL).origin ? undefined : origin;
  } catch {
    return null;
  }
}

export default async function EmbedPage({ params }: PageProps<"/embed/[token]">) {
  const { token } = await params;
  let data: Awaited<ReturnType<typeof publicWidget>> | null = null;
  try {
    data = await publicWidget(decodeURIComponent(token), await embedderOrigin());
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-zinc-500">This widget is unavailable.</p>
      </div>
    );
  }
  return <EmbedClient token={decodeURIComponent(token)} data={data} />;
}
