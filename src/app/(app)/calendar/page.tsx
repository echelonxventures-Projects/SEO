"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Flight = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  budgetMinor: number | bigint | null;
  channel: { id: string; code: string; name: string; kind: string };
  campaign: { id: string; name: string; client: { name: string } | null };
  audience: { id: string; name: string } | null;
};
type PostSlot = { id: string; status: string; scheduledAt: string; post: { id: string; title: string }; connection: { connectorKey: string; handle: string } };
type View = { from: string; to: string; flights: Flight[]; posts: PostSlot[]; conflicts: Array<{ channelId: string; channelName: string; a: string; b: string }> };
type TimelineItem = { domain: string; id: string; title: string; start: string; color: string; source: string };

const KIND_COLORS: Record<string, string> = {
  SEARCH: "bg-sky-500", SOCIAL: "bg-violet-500", DISPLAY: "bg-pink-500", VIDEO: "bg-red-500",
  EMAIL: "bg-emerald-500", WHATSAPP: "bg-green-500", SMS: "bg-amber-500", ORGANIC: "bg-teal-500",
};

export default function CalendarPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [view, setView] = useState<View | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const last = new Date(Date.UTC(month.y, month.m + 1, 0));
    const from = new Date(first.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(last.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    return { first, last, from, to };
  }, [month]);

  const load = useCallback(() => {
    setLoading(true);
    api.get<View>(`/calendar?from=${range.from}&to=${range.to}`)
      .then(setView)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
    api.get<{ items: TimelineItem[] }>(`/temporal/timeline?from=${range.from}&to=${range.to}`)
      .then((r) => setTimeline(r.items))
      .catch(() => setTimeline([]));
  }, [range]);
  useEffect(load, [load]);

  const weeks = useMemo(() => {
    const start = new Date(range.first);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday first
    const out: Date[][] = [];
    const cursor = new Date(start);
    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      out.push(week);
    }
    return out;
  }, [range]);

  const dayFlights = (d: Date) =>
    (view?.flights ?? []).filter((f) => {
      const t = d.getTime();
      return new Date(f.startsAt).getTime() <= t + 86400_000 - 1 && new Date(f.endsAt).getTime() >= t;
    });
  const dayPosts = (d: Date) =>
    (view?.posts ?? []).filter((p) => new Date(p.scheduledAt).toISOString().slice(0, 10) === d.toISOString().slice(0, 10));
  const dayTimeline = (d: Date) => {
    const key = d.toISOString().slice(0, 10);
    return timeline.filter((t) => t.start.slice(0, 10) === key && t.domain !== "FLIGHT" && t.domain !== "PUBLISH");
  };
  const DOMAIN_DOT: Record<string, string> = { EVENT: "#6366f1", APPOINTMENT: "#22c55e", EMAIL: "#06b6d4", TASK: "#64748b", REPORT: "#a3a3a3" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div>
      <PageHeader
        title="Campaign calendar"
        description="Flights, scheduled posts and every other temporal commitment (UTP timeline: meetings ●, appointments ●, sends ●, tasks ●, reports ●) in one plan. Overlaps flagged."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/campaigns/new"><Badge className="bg-zinc-900 px-3 py-1 text-white hover:opacity-90 dark:bg-white dark:text-zinc-900">+ Guided campaign</Badge></Link>
            <button className="rounded-lg border p-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}><ChevronLeft className="h-4 w-4" /></button>
            <span className="w-36 text-center text-sm font-semibold">{range.first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>
            <button className="rounded-lg border p-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: (c.m + 1) % 12 }))}><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />
      {view && view.conflicts.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ {view.conflicts.length} overlapping flight(s) on the same channel: {view.conflicts.map((c) => c.channelName).join(", ")}
        </div>
      )}
      <Card>
        <div className="grid grid-cols-7 border-b border-zinc-100 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-zinc-100 last:border-0 dark:border-zinc-800">
            {week.map((d) => {
              const inMonth = d.getUTCMonth() === month.m;
              const isToday = d.getTime() === today.getTime();
              const fl = dayFlights(d);
              const ps = dayPosts(d);
              const tl = dayTimeline(d);
              return (
                <div key={d.toISOString()} className={cn("min-h-24 border-r border-zinc-100 p-1.5 last:border-0 dark:border-zinc-800", !inMonth && "bg-zinc-50/60 opacity-50 dark:bg-zinc-900/40")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn("text-xs", isToday ? "rounded-full bg-zinc-900 px-1.5 font-bold text-white dark:bg-white dark:text-zinc-900" : "text-zinc-400")}>{d.getUTCDate()}</span>
                    <span className="flex items-center gap-1">
                      {tl.map((t) => <span key={t.id} title={`${t.domain.toLowerCase()} · ${t.title}`} className="h-1.5 w-1.5 rounded-full" style={{ background: DOMAIN_DOT[t.domain] ?? t.color }} />)}
                      {ps.length > 0 && <span className="text-[10px] text-sky-600">{ps.length} post{ps.length > 1 ? "s" : ""}</span>}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {fl.slice(0, 3).map((f) => (
                      <Link key={f.id} href={`/campaigns/${f.campaign.id}`} title={`${f.channel.name} · ${f.campaign.name}`} className={cn("block truncate rounded px-1 py-0.5 text-[10px] font-medium text-white", KIND_COLORS[f.channel.kind] ?? "bg-zinc-400")}>
                        {f.channel.name}
                      </Link>
                    ))}
                    {fl.length > 3 && <span className="text-[10px] text-zinc-400">+{fl.length - 3} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {loading && <div className="p-4 text-center text-sm text-zinc-400">Loading calendar…</div>}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Flights" description={`${view?.flights.length ?? 0} in view`} />
          <div className="max-h-80 overflow-auto">
            {(view?.flights ?? []).map((f) => (
              <div key={f.id} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 text-sm last:border-0 dark:border-zinc-800">
                <div>
                  <p className="font-medium">{f.channel.name} <span className="text-xs text-zinc-400">· {f.campaign.name}{f.audience ? ` · ${f.audience.name}` : ""}</span></p>
                  <p className="text-xs text-zinc-400">{new Date(f.startsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → {new Date(f.endsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{f.budgetMinor != null ? ` · ${fmtMoney(Number(f.budgetMinor))}` : ""}</p>
                </div>
                <StatusBadge value={f.status} />
              </div>
            ))}
            {(view?.flights.length ?? 0) === 0 && !loading && <p className="px-4 py-6 text-center text-sm text-zinc-400">No flights in this window</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Scheduled posts" description={`${view?.posts.length ?? 0} queued or published`} />
          <div className="max-h-80 overflow-auto">
            {(view?.posts ?? []).slice(0, 60).map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm last:border-0 dark:border-zinc-800">
                <div>
                  <p className="font-medium">{p.post.title}</p>
                  <p className="text-xs text-zinc-400">{p.connection.handle} · {new Date(p.scheduledAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <StatusBadge value={p.status} />
              </div>
            ))}
            {(view?.posts.length ?? 0) === 0 && !loading && <p className="px-4 py-6 text-center text-sm text-zinc-400">Nothing scheduled — generate slots from a cadence</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
