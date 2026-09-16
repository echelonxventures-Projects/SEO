import { publicWidget } from "@/server/services/temporal-widgets.service";
import { EmbedClient } from "./embed-client";

export const metadata = { title: "Book a time" };
export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: PageProps<"/embed/[token]">) {
  const { token } = await params;
  let data: Awaited<ReturnType<typeof publicWidget>> | null = null;
  try {
    data = await publicWidget(decodeURIComponent(token), null);
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
