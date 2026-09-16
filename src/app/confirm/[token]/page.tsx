import { confirmOptin } from "@/server/services/email.service";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params }: PageProps<"/confirm/[token]">) {
  const { token } = await params;
  let ok = false;
  try {
    await confirmOptin(decodeURIComponent(token));
    ok = true;
  } catch {
    ok = false;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className={`text-lg font-semibold ${ok ? "text-emerald-600" : "text-red-600"}`}>
          {ok ? "Subscription confirmed" : "This confirmation link is no longer valid"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {ok ? "You'll receive the newsletter from now on — every email includes a one-click unsubscribe." : "The link may have expired or already been used."}
        </p>
      </div>
    </div>
  );
}
