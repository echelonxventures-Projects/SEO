"use client";

import { useState } from "react";
import { CalendarDays, Check } from "lucide-react";

type Slot = { id: string; startsAt: string; endsAt: string; remaining: number };

export function BookingClient({ token, calendar, slots }: { token: string; calendar: { name: string; color: string; timezone: string }; slots: Slot[] }) {
  const [picked, setPicked] = useState<Slot | null>(null);
  const [f, setF] = useState({ attendeeName: "", attendeeEmail: "", service: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ referenceCode: string; waitlisted: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byDay = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    const day = s.startsAt.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  if (done) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600"><Check className="h-6 w-6" /></div>
        <h1 className="text-lg font-semibold">{done.waitlisted ? "You're on the waitlist" : "Booked!"}</h1>
        <p className="mt-1 text-sm text-zinc-500">{done.waitlisted ? "We'll confirm automatically if a spot opens." : `Your slot at ${calendar.name} is confirmed.`}</p>
        <p className="mt-3 font-mono text-sm text-indigo-600">{done.referenceCode}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: calendar.color }} />
        <h1 className="text-lg font-semibold">{calendar.name}</h1>
        <span className="ml-auto flex items-center gap-1 text-xs text-zinc-400"><CalendarDays className="h-3.5 w-3.5" /> {calendar.timezone}</span>
      </div>
      {slots.length === 0 && <p className="text-sm text-zinc-400">No open times right now — check back soon.</p>}
      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">{new Date(`${day}T00:00:00Z`).toUTCString().slice(0, 16)}</p>
          <div className="flex flex-wrap gap-1.5">
            {list.map((s) => (
              <button
                key={s.startsAt}
                onClick={() => { setPicked(s); setError(null); }}
                className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums transition ${picked === s ? "border-indigo-500 bg-indigo-500 text-white" : "border-zinc-200 hover:border-indigo-300 dark:border-zinc-700"}`}
              >
                {new Date(s.startsAt).toISOString().slice(11, 16)}
                {s.remaining > 1 ? <span className="ml-1 text-[10px] opacity-70">×{s.remaining}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
      {picked && (
        <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
          <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" placeholder="Your name *" value={f.attendeeName} onChange={(e) => setF({ ...f, attendeeName: e.target.value })} />
          <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" placeholder="Email (optional)" type="email" value={f.attendeeEmail} onChange={(e) => setF({ ...f, attendeeEmail: e.target.value })} />
          <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" placeholder="What's it for? (optional)" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            disabled={busy || !f.attendeeName.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const idem = `bk-${picked.id}-${Math.random().toString(36).slice(2, 8)}`;
                const res = await fetch(`/api/v1/public/booking/${encodeURIComponent(token)}`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "idempotency-key": idem },
                  body: JSON.stringify({ slotId: picked.id, attendeeName: f.attendeeName, attendeeEmail: f.attendeeEmail || null, service: f.service || null }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json?.error?.message ?? "Booking failed");
                setDone(json.data);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Booking failed");
              } finally {
                setBusy(false);
              }
            }}
            className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {busy ? "Booking…" : `Confirm ${new Date(picked.startsAt).toISOString().slice(11, 16)} · ${picked.startsAt.slice(0, 10)}`}
          </button>
        </div>
      )}
    </div>
  );
}
