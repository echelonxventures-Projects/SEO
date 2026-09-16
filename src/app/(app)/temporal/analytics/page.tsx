"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { toast } from "@/components/toast";

type Stats = {
  windowDays: number;
  calendars: number;
  patterns: number;
  events: number;
  appointments: Record<string, number>;
  waitlisted: number;
  conflictsDetected: number;
  triggerOutcomes: Record<string, number>;
  executions: Record<string, number>;
  resourceUtilization: Array<{ name: string; utilizationBps: number; bookedMinutes: number; bookings: number }>;
};
type Trends = { days: number; buckets: Array<{ day: string; events: number; appointments: number; slots: number }> };

export default function TemporalAnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [forecast, setForecast] = useState<Array<{ date: string; projectedUtilizationBps: number }> | null>(null);
  const [insight, setInsight] = useState<{ text: string; engine: string } | null>(null);
  const [insBusy, setInsBusy] = useState(false);

  useEffect(() => {
    api.get<Stats>("/temporal/analytics?days=30").then(setStats).catch((e) => toast("error", e.message));
    api.get<Trends>("/temporal/analytics/trends?days=30").then(setTrends).catch(() => undefined);
    api.get<Array<{ id: string }>>("/temporal/calendars").then(async (cs) => {
      if (!cs[0]) return;
      const f = await api.get<{ forecast: Array<{ date: string; projectedUtilizationBps: number }> }>(`/temporal/intelligence/forecast?calendarId=${cs[0].id}&weeks=6`).catch(() => null);
      if (f) setForecast(f.forecast);
    });
  }, []);

  const maxBucket = Math.max(1, ...(trends?.buckets.map((b) => b.events + b.appointments) ?? [1]));

  return (
    <div>
      <PageHeader title="Temporal analytics" description="Utilization, scheduling throughput, availability pressure, forecast & operations." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <CardHeader title="Scheduling throughput (30d)" description="Occurrences + appointments per day" />
          <Card className="p-4">
            <div className="flex h-40 items-end gap-[3px]">
              {(trends?.buckets ?? []).map((b) => (
                <div key={b.day} className="group relative flex-1">
                  <div className="w-full rounded-t bg-gradient-to-t from-indigo-500 to-sky-400 transition group-hover:opacity-80" style={{ height: `${((b.events + b.appointments) / maxBucket) * 160}px`, minHeight: 2 }} title={`${b.day}: ${b.events} occ · ${b.appointments} appt · ${b.slots} slots`} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
              <span>{trends?.buckets[0]?.day ?? ""}</span><span>{trends?.buckets[trends.buckets.length - 1]?.day ?? ""}</span>
            </div>
          </Card>
        </div>
        <div>
          <CardHeader title="Resource utilization" description="Merged-interval busy time vs 30-day capacity" />
          <Card className="p-4">
            {(stats?.resourceUtilization ?? []).map((r) => (
              <div key={r.name} className="mb-3 last:mb-0">
                <div className="flex justify-between text-xs"><span className="font-medium">{r.name}</span><span className="tabular-nums text-zinc-500">{(r.utilizationBps / 100).toFixed(1)}% · {r.bookedMinutes}min · {r.bookings} bookings</span></div>
                <div className="h-2 rounded bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded bg-emerald-500" style={{ width: `${Math.min(100, r.utilizationBps / 100)}%` }} /></div>
              </div>
            ))}
            {!stats?.resourceUtilization?.length && <p className="text-sm text-zinc-400">No resources booked yet.</p>}
          </Card>
        </div>
        <div>
          <CardHeader title="Capacity forecast" description="Weekday-average projection from booking history" actions={<Button size="sm" variant="outline" loading={insBusy} onClick={async () => {
            setInsBusy(true);
            try {
              const cs = await api.get<Array<{ id: string }>>("/temporal/calendars");
              if (!cs[0]) { toast("error", "No calendars yet"); return; }
              setInsight(await api.post<{ text: string; engine: string }>("/temporal/intelligence/insight", { calendarId: cs[0].id, weeks: 6 }));
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } finally { setInsBusy(false); }
          }}>AI insight</Button>} />
          <Card className="p-4">
            <div className="flex h-24 items-end gap-2">
              {(forecast ?? []).map((f) => (
                <div key={f.date} className="flex-1" title={`${f.date}: ${(f.projectedUtilizationBps / 100).toFixed(1)}%`}>
                  <div className="w-full rounded-t bg-violet-400" style={{ height: `${Math.min(96, f.projectedUtilizationBps / 100)}px`, minHeight: 2 }} />
                  <p className="mt-1 text-center text-[9px] text-zinc-400">{f.date.slice(5)}</p>
                </div>
              ))}
            </div>
            {!forecast && <p className="text-sm text-zinc-400">Seed bookings to see the forecast.</p>}
            {insight && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">Engine: {insight.engine}</p>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{insight.text}</p>
              </div>
            )}
          </Card>
        </div>
        <div>
          <CardHeader title="Operations" />
          <Card className="divide-y">
            {[
              ["Calendars", stats?.calendars],
              ["Temporal patterns", stats?.patterns],
              ["Scheduled events (masters)", stats?.events],
              ["Appointments total", Object.values(stats?.appointments ?? {}).reduce((a, b) => a + b, 0)],
              ["Waitlisted", stats?.waitlisted],
              ["Conflicts detected (45d window)", stats?.conflictsDetected],
              ["Trigger fires succeeded", stats?.triggerOutcomes?.SUCCESS],
              ["Executions completed", stats?.executions?.COMPLETED],
              ["Executions failed", stats?.executions?.FAILED],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-zinc-500">{k}</span>
                <span className="font-semibold tabular-nums">{v ?? "—"}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
