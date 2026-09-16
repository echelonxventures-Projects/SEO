"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { toast } from "@/components/toast";
import { CalendarDays, CalendarRange, Armchair, Clock, HardHat, ShieldCheck, Zap, Library, LineChart } from "lucide-react";

type Stats = {
  calendars: number;
  patterns: number;
  events: number;
  waitlisted: number;
  conflictsDetected: number;
  appointments: Record<string, number>;
  triggerOutcomes: Record<string, number>;
  executions: Record<string, number>;
  resourceUtilization: Array<{ name: string; utilizationBps: number }>;
};

const TILES = [
  { href: "/temporal/patterns", icon: CalendarRange, title: "Patterns & DSL", desc: "Reusable temporal assets with a live compiler studio." },
  { href: "/temporal/calendars", icon: CalendarDays, title: "Calendars", desc: "Spaces, sharing, security, agenda across teams & resources." },
  { href: "/temporal/appointments", icon: Clock, title: "Appointments", desc: "Slots, booking, waitlist promotion, check-in." },
  { href: "/temporal/resources", icon: Armchair, title: "Resources", desc: "Rooms, equipment, vehicles & studios with capacity conflicts." },
  { href: "/temporal/workforce", icon: HardHat, title: "Workforce", desc: "Shifts, rotations and coverage gap detection." },
  { href: "/temporal/triggers", icon: Zap, title: "Triggers", desc: "Temporal automation with retry, routing & monitoring." },
  { href: "/temporal/library", icon: Library, title: "Temporal library", desc: "Business hours, holidays, fiscal, industry packs, planetary time." },
  { href: "/temporal/analytics", icon: LineChart, title: "Analytics", desc: "Utilization, throughput, forecasting & conflicts." },
  { href: "/temporal/governance", icon: ShieldCheck, title: "Governance", desc: "Immutable event store, replay, time-travel, retention." },
];

export default function TemporalHubPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [agenda, setAgenda] = useState<Array<{ id: string; title: string; startsAt: string; endsAt: string; local: string; calendar: { name: string; color: string } }>>([]);

  useEffect(() => {
    api.get<Stats>("/temporal/analytics?days=30").then(setStats).catch((e) => toast("error", e.message));
    api.get<{ occurrences: typeof agenda }>("/temporal/agenda?from=&to=").then((r) => setAgenda(r.occurrences.slice(0, 8))).catch(() => undefined);
  }, []);

  return (
    <div>
      <PageHeader title="Universal Temporal Platform" description="One enterprise authority for time, patterns, availability, appointments, resources, triggers and governance. Schedules are assets — everything consumes them." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "Calendars", v: stats?.calendars },
          { k: "Temporal patterns", v: stats?.patterns },
          { k: "Scheduled events", v: stats?.events },
          { k: "Conflicts (45d)", v: stats?.conflictsDetected },
          { k: "Appointments confirmed", v: stats?.appointments?.CONFIRMED },
          { k: "Waitlisted", v: stats?.waitlisted },
          { k: "Trigger fires OK", v: stats?.triggerOutcomes?.SUCCESS },
          { k: "Executions completed", v: stats?.executions?.COMPLETED },
        ].map((m) => (
          <Card key={m.k} className="p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-400">{m.k}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{m.v ?? "—"}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="p-4 transition hover:border-indigo-400">
              <div className="flex items-center gap-3">
                <t.icon className="h-5 w-5 text-indigo-500" />
                <p className="font-semibold">{t.title}</p>
              </div>
              <p className="mt-2 text-sm text-zinc-500">{t.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <CardHeader title="Next occurrences" description="Materialized stream across every visible calendar" actions={<Badge className="bg-indigo-500/15 text-indigo-600">{agenda.length}</Badge>} />
        <Card className="divide-y">
          {agenda.length === 0 && <p className="p-4 text-sm text-zinc-400">Nothing scheduled in the next two weeks.</p>}
          {agenda.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: o.calendar.color }} />
                <span className="font-medium">{o.title}</span>
                <span className="text-xs text-zinc-400">{o.calendar.name}</span>
              </div>
              <span className="tabular-nums text-xs text-zinc-500">{new Date(o.startsAt).toUTCString().slice(5, 16)} · {o.local} local</span>
            </div>
          ))}
        </Card>
      </div>
      {stats?.resourceUtilization?.length ? (
        <div className="mt-6">
          <CardHeader title="Resource utilization (30d)" description="Merged-interval math against calendar capacity" />
          <Card className="p-4">
            {stats.resourceUtilization.map((r) => (
              <div key={r.name} className="mb-2 last:mb-0">
                <div className="flex justify-between text-xs"><span>{r.name}</span><span className="tabular-nums text-zinc-500">{(r.utilizationBps / 100).toFixed(1)}%</span></div>
                <div className="h-1.5 rounded bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded bg-indigo-500" style={{ width: `${Math.min(100, r.utilizationBps / 100)}%` }} /></div>
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
