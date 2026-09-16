import { publicAgenda } from "@/server/services/temporal-booking.service";
import { BookingClient } from "./booking-client";

export const metadata = { title: "Book a time" };
export const dynamic = "force-dynamic";

type Resolved =
  | { ok: false }
  | { ok: true; calendar: { name: string; color: string; timezone: string }; slots: Array<{ id: string; startsAt: string; endsAt: string; remaining: number }> };

export default async function BookPage({ params }: PageProps<"/book/[token]">) {
  const { token } = await params;
  let resolved: Resolved;
  try {
    const data = await publicAgenda(decodeURIComponent(token));
    resolved = {
      ok: true,
      calendar: data.calendar,
      slots: data.slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), remaining: s.remaining })),
    };
  } catch {
    resolved = { ok: false };
  }
  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-100 p-4 pt-16 dark:bg-zinc-950">
      <div className="w-full max-w-lg">
        {!resolved.ok ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <h1 className="text-lg font-semibold text-red-600">Invalid link</h1>
            <p className="mt-2 text-sm text-zinc-500">This booking link is not valid or has expired.</p>
          </div>
        ) : (
          <BookingClient token={decodeURIComponent(token)} calendar={resolved.calendar} slots={resolved.slots} />
        )}
      </div>
    </div>
  );
}
