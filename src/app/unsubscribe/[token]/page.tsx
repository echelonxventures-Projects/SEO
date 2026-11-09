import { unsubscribe } from "@/server/services/email.service";
import { verifyToken } from "@/server/tokens";

export const dynamic = "force-dynamic";

/**
 * GET only renders a confirm button. Unsubscribing on GET would let mail
 * security scanners (which open every link in a message) unsubscribe people
 * who never clicked. The actual change happens in the POST server action.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: PageProps<"/unsubscribe/[token]">) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const done = (await searchParams).done === "1";

  let valid = true;
  try {
    verifyToken("email_unsub", token);
  } catch {
    valid = false;
  }

  async function confirm() {
    "use server";
    const { redirect } = await import("next/navigation");
    await unsubscribe(token);
    redirect(`/unsubscribe/${encodeURIComponent(token)}?done=1`);
  }

  const title = !valid ? "This unsubscribe link is invalid" : done ? "You've been unsubscribed" : "Unsubscribe from this list?";
  const body = !valid
    ? "If you keep receiving mail, reply to any campaign email and we'll remove you manually."
    : done
      ? "You will not receive this newsletter again. No further action is needed."
      : "You'll stop receiving emails from this mailing list.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{body}</p>
        {valid && !done && (
          <form action={confirm} className="mt-6">
            <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
