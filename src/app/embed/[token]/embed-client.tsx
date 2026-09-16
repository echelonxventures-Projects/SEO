"use client";

import { useState } from "react";

type Data = {
  kind: string;
  appearance: Record<string, unknown>;
  calendar: { name: string; color: string; timezone: string };
  slots: Array<{ id: string; startsAt: string; endsAt: string; remaining: number }>;
  behavior: Record<string, unknown>;
};

export function EmbedClient({ token, data }: { token: string; data: Data }) {
  const [picked, setPicked] = useState<Data["slots"][number] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const primary = typeof data.appearance.primaryColor === "string" ? data.appearance.primaryColor : data.calendar.color;
  const title = typeof data.appearance.title === "string" ? data.appearance.title : data.calendar.name;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 dark:bg-zinc-950">
        <div className="text-center">
          <p className="text-lg font-semibold" style={{ color: primary }}>Booked!</p>
          <p className="mt-1 font-mono text-sm text-zinc-500">{done}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <h1 className="text-base font-semibold" style={{ color: primary }}>{title}</h1>
      <p className="mb-3 text-xs text-zinc-400">{data.calendar.timezone} · {data.kind.toLowerCase()}</p>
      <div className="flex flex-wrap gap-1.5">
        {data.slots.slice(0, 24).map((s) => (
          <button
            key={s.id}
            onClick={() => setPicked(s)}
            className="rounded-lg border px-3 py-1.5 text-sm tabular-nums"
            style={picked?.id === s.id ? { background: primary, borderColor: primary, color: "#fff" } : { borderColor: "#d4d4d8" }}
          >
            {new Date(s.startsAt).toISOString().slice(5, 16).replace("T", " ")}
          </button>
        ))}
        {data.slots.length === 0 && <p className="text-sm text-zinc-400">No open times right now.</p>}
      </div>
      {picked && (
        <div className="mt-3 space-y-2">
          <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" placeholder="Your name *" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button
            disabled={busy || !name.trim()}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: primary }}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const res = await fetch(`/api/v1/public/widget/${encodeURIComponent(token)}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ slotId: picked.id, attendeeName: name, attendeeEmail: email || null, service: null }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json?.error?.message ?? "Booking failed");
                setDone(json.data.referenceCode);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Booking failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Booking…" : "Confirm booking"}
          </button>
        </div>
      )}
    </div>
  );
}
