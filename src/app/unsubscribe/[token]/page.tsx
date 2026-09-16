import { unsubscribe } from "@/server/services/email.service";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  let ok = false;
  try {
    await unsubscribe(decodeURIComponent(token));
    ok = true;
  } catch {
    ok = false;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">{ok ? "You've been unsubscribed" : "This unsubscribe link is invalid"}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {ok ? "You will not receive this newsletter again. No further action is needed." : "If you keep receiving mail, reply to any campaign email and we'll remove you manually."}
        </p>
      </div>
    </div>
  );
}
