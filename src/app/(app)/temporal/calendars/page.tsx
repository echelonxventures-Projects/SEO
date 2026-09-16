"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Calendar = { id: string; name: string; code: string; kind: string; visibility: string; timezone: string; color: string; space: string | null; myPermission: string; archivedAt: string | null; _count: { events: number; appointments: number; shares: number }; pattern?: { name: string; dsl: string | null } | null };
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
type TItem = { domain: string; id: string; title: string; start: string; end: string | null; status: string | null; source: string; color: string };

const DOMAIN_DOT: Record<string, string> = { EVENT: "#6366f1", APPOINTMENT: "#22c55e", EMAIL: "#06b6d4", TASK: "#64748b", REPORT: "#a3a3a3", FLIGHT: "#f59e0b", PUBLISH: "#8b5cf6" };
const KIND_COLORS: Record<string, string> = {
  SEARCH: "bg-sky-500", SOCIAL: "bg-violet-500", DISPLAY: "bg-pink-500", VIDEO: "bg-red-500",
  EMAIL: "bg-emerald-500", WHATSAPP: "bg-green-500", SMS: "bg-amber-500", ORGANIC: "bg-teal-500",
};
const DOMAIN_LABEL: Record<string, string> = { EVENT: "Events", APPOINTMENT: "Appointments", FLIGHT: "Flights", PUBLISH: "Publishes", EMAIL: "Sends", TASK: "Tasks", REPORT: "Report runs" };

export default function CalendarsPage() {
  const [rows, setRows] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState<Calendar | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [view, setView] = useState<View | null>(null);
  const [timeline, setTimeline] = useState<TItem[]>([]);
  const [loadingGrid, setLoadingGrid] = useState(true);

  const range = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const last = new Date(Date.UTC(month.y, month.m + 1, 0));
    const from = new Date(first.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
    const to = new Date(last.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    return { first, last, from, to };
  }, [month]);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Calendar[]>("/temporal/calendars").then(setRows).catch((e) => toast("error", e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    setLoadingGrid(true);
    api.get<View>(`/calendar?from=${range.from}&to=${range.to}`)
      .then(setView)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoadingGrid(false));
    api.get<{ items: TItem[] }>(`/temporal/timeline?from=${range.from}&to=${range.to}`)
      .then((r) => setTimeline(r.items))
      .catch(() => setTimeline([]));
  }, [range]);

  const weeks = useMemo(() => {
    const start = new Date(range.first);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
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
    (view?.flights ?? []).filter((f) => new Date(f.startsAt).getTime() <= d.getTime() + 86400_000 - 1 && new Date(f.endsAt).getTime() >= d.getTime());
  const dayPosts = (d: Date) =>
    (view?.posts ?? []).filter((p) => new Date(p.scheduledAt).toISOString().slice(0, 10) === d.toISOString().slice(0, 10));
  const dayTimeline = (d: Date) => timeline.filter((t) => t.start.slice(0, 10) === d.toISOString().slice(0, 10));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const domainsToday = [...new Set(timeline.map((t) => t.domain))].sort();

  return (
    <div>
      <PageHeader
        title="Calendars"
        description="The single temporal surface — calendar spaces, event occurrences, appointments, flights, publishes and every other scheduled commitment in one grid. No other page owns a calendar."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/campaigns/new"><Badge className="bg-zinc-900 px-3 py-1 text-white hover:opacity-90 dark:bg-white dark:text-zinc-900">+ Guided campaign</Badge></Link>
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New calendar</Button>
            <button className="rounded-lg border p-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setMonth((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}><ChevronLeft className="h-4 w-4" /></button>
            <span className="w-36 text-center text-sm font-semibold">{range.first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <button className="rounded-lg border p-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setMonth((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: (c.m + 1) % 12 }))}><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      {view && view.conflicts.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ {view.conflicts.length} overlapping flight(s) on the same channel: {view.conflicts.map((c) => c.channelName).join(", ")}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        {Object.entries(DOMAIN_DOT).map(([d, color]) => (
          <span key={d} className="flex items-center gap-1.5 text-zinc-500">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {DOMAIN_LABEL[d] ?? d.toLowerCase()}
          </span>
        ))}
        <span className="ml-auto text-zinc-400">{timeline.length} scheduled items in view{domainsToday.length ? ` · ${domainsToday.length} domains` : ""}</span>
      </div>

      <Card className="mb-6">
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
                      {tl.slice(0, 5).map((t) => <span key={`${t.domain}-${t.id}`} title={`${t.domain.toLowerCase()} · ${t.title}`} className="h-1.5 w-1.5 rounded-full" style={{ background: DOMAIN_DOT[t.domain] ?? t.color }} />)}
                      {ps.length > 0 && <span className="text-[10px] text-sky-600">{ps.length}</span>}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {fl.slice(0, 2).map((f) => (
                      <Link key={f.id} href={`/campaigns/${f.campaign.id}`} title={`${f.channel.name} · ${f.campaign.name}`} className={cn("block truncate rounded px-1 py-0.5 text-[10px] font-medium text-white", KIND_COLORS[f.channel.kind] ?? "bg-zinc-400")}>
                        {f.channel.name}
                      </Link>
                    ))}
                    {tl.filter((t) => t.domain !== "FLIGHT" && t.domain !== "PUBLISH").slice(0, 2).map((t) => (
                      <div key={t.id} className="truncate rounded px-1 py-0.5 text-[10px]" style={{ background: `${DOMAIN_DOT[t.domain] ?? t.color}18`, color: DOMAIN_DOT[t.domain] ?? t.color }} title={`${t.domain.toLowerCase()} · ${t.title}`}>
                        {t.title}
                      </div>
                    ))}
                    {fl.length + tl.length > 4 && <span className="text-[10px] text-zinc-400">+{fl.length + tl.length - 4} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {loadingGrid && <div className="p-4 text-center text-sm text-zinc-400">Loading calendar…</div>}
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <p className="font-semibold">{c.name}</p>
              </div>
              <Badge className="bg-zinc-500/10 text-zinc-500">{c.myPermission.toLowerCase()}</Badge>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{c.code} · {c.kind.toLowerCase()} · {c.visibility.toLowerCase()} · {c.timezone}</p>
            {c.space && <p className="text-xs text-zinc-400">space: {c.space}</p>}
            <p className="mt-2 text-xs text-zinc-500">{c._count.events} events · {c._count.appointments} appointments · {c._count.shares} shares</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={async () => {
                try {
                  const r = await api.get<{ path: string }>(`/temporal/calendars/${c.id}/feed-link`);
                  const url = `${window.location.origin}${r.path}`;
                  await navigator.clipboard?.writeText(url).catch(() => undefined);
                  toast("success", "ICS feed copied — paste into Google/Apple Calendar (webcal works too)");
                  window.open(r.path, "_blank");
                } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
              }}>ICS</Button>
              <Button size="sm" variant="outline" onClick={() => setSharing(c)}><Share2 className="h-3 w-3" /> Share</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (window.confirm(`Archive ${c.name}?`)) { try { await api.del(`/temporal/calendars/${c.id}`); toast("success", "Archived"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } } }}>Archive</Button>
            </div>
          </Card>
        ))}
        {loading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60" />)}
      </div>

      <CardHeader title="Flights in view" description={`${view?.flights.length ?? 0} campaign flights · ${view?.posts.length ?? 0} queued posts`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="max-h-72 overflow-auto">
            {(view?.flights ?? []).map((f) => (
              <div key={f.id} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 text-sm last:border-0 dark:border-zinc-800">
                <div>
                  <p className="font-medium">{f.channel.name} <span className="text-xs text-zinc-400">· {f.campaign.name}{f.audience ? ` · ${f.audience.name}` : ""}</span></p>
                  <p className="text-xs text-zinc-400">{new Date(f.startsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })} → {new Date(f.endsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })}{f.budgetMinor != null ? ` · ${fmtMoney(Number(f.budgetMinor))}` : ""}</p>
                </div>
                <StatusBadge value={f.status} />
              </div>
            ))}
            {(view?.flights.length ?? 0) === 0 && !loadingGrid && <p className="px-4 py-6 text-center text-sm text-zinc-400">No flights in this window</p>}
          </div>
        </Card>
        <Card>
          <div className="max-h-72 overflow-auto">
            {(view?.posts ?? []).slice(0, 60).map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm last:border-0 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.post.title}</p>
                  <p className="text-xs text-zinc-400">{p.connection.connectorKey} · {new Date(p.scheduledAt).toUTCString().slice(5, 22)}</p>
                </div>
                <StatusBadge value={p.status} />
              </div>
            ))}
            {(view?.posts.length ?? 0) === 0 && !loadingGrid && <p className="px-4 py-6 text-center text-sm text-zinc-400">No queued posts in this window</p>}
          </div>
        </Card>
      </div>

      {open && <NewCalendar onClose={() => setOpen(false)} onDone={load} />}
      {sharing && <ShareModal cal={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

function NewCalendar({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [patterns, setPatterns] = useState<Array<{ id: string; name: string }>>([]);
  const [f, setF] = useState({ name: "", code: "", kind: "TEAM", visibility: "INTERNAL", timezone: "Asia/Kolkata", color: "#6366f1", space: "", patternId: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Array<{ id: string; name: string }>>("/temporal/patterns").then(setPatterns).catch(() => undefined); }, []);
  return (
    <Modal open onClose={onClose} title="New calendar">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} placeholder="team-eng" /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={["PERSONAL", "TEAM", "RESOURCE", "PROJECT", "EVENT", "CAMPAIGN", "SYSTEM", "FISCAL", "MAINTENANCE", "SHIFT"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
        <Field label="Visibility"><Select value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })} options={["PRIVATE", "INTERNAL", "PUBLIC"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
        <Field label="Timezone"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <Field label="Space (optional)"><Input value={f.space} onChange={(e) => setF({ ...f, space: e.target.value })} /></Field>
        <Field label="Default pattern (optional)" className="col-span-2"><Select value={f.patternId} onChange={(e) => setF({ ...f, patternId: e.target.value })} options={[{ value: "", label: "—" }, ...patterns.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/temporal/calendars", { name: f.name, code: f.code, kind: f.kind, visibility: f.visibility, timezone: f.timezone, color: f.color, space: f.space || null, patternId: f.patternId || null });
              toast("success", "Calendar created");
              onDone();
              onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}

function ShareModal({ cal, onClose }: { cal: Calendar; onClose: () => void }) {
  const [shares, setShares] = useState<Array<{ id: string; principalType: string; principalId: string; permission: string }>>([]);
  const [toks, setToks] = useState<{ count: number; hints: string[] } | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [pick, setPick] = useState("");
  const [perm, setPerm] = useState("VIEW");
  const load = useCallback(() => {
    api.get<{ shares: typeof shares }>(`/temporal/calendars/${cal.id}`).then((r) => setShares(r.shares)).catch(() => undefined);
    api.get<{ count: number; hints: string[] }>(`/temporal/calendars/${cal.id}/share-tokens`).then(setToks).catch(() => undefined);
  }, [cal.id]);
  useEffect(() => {
    load();
    api.get<{ members: Array<{ id: string; userId?: string; name: string; email: string }> }>("/team/members").then((r) => setUsers((r.members ?? []).map((m) => ({ id: m.userId ?? m.id, name: m.name, email: m.email })))).catch(() => undefined);
  }, [load]);
  return (
    <Modal open onClose={onClose} title={`Share “${cal.name}”`}>
      <div className="grid gap-2">
        {shares.map((sh) => (
          <div key={sh.id} className="flex items-center justify-between rounded border px-2 py-1.5 text-sm">
            <span>{sh.principalType.toLowerCase()}: <b>{users.find((u) => u.id === sh.principalId)?.name ?? sh.principalId}</b></span>
            <span className="flex items-center gap-2">
              <Badge className="bg-indigo-500/10 text-indigo-600">{sh.permission}</Badge>
              <button className="text-xs text-red-500 hover:underline" onClick={async () => { try { await api.del(`/temporal/calendars/${cal.id}/shares/${sh.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>remove</button>
            </span>
          </div>
        ))}
        {toks && toks.count > 0 && (
          <div className="mt-3 rounded-lg border border-dashed p-2">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>🔗 {toks.count} active share token(s): {toks.hints.join(", ")}</span>
              <button className="text-red-500 hover:underline" onClick={async () => {
                if (!window.confirm("Revoke ALL public booking links & ICS feeds for this calendar?")) return;
                try { await api.del(`/temporal/calendars/${cal.id}/share-tokens`); toast("success", "All links revoked"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
              }}>revoke all</button>
            </div>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} options={[{ value: "public|PUBLIC", label: "🌐 public (link-visible)" }, ...users.map((u) => ({ value: `${u.id}|USER`, label: u.name }))]} className="flex-1" />
          <Select value={perm} onChange={(e) => setPerm(e.target.value)} options={["VIEW", "SUGGEST", "EDIT", "MANAGE"].map((v) => ({ value: v, label: v }))} />
          <Button onClick={async () => {
            const [principalId, principalType] = pick.split("|");
            try {
              await api.post(`/temporal/calendars/${cal.id}/share`, { principalType, principalId, permission: perm });
              toast("success", "Shared");
              load();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
          }}>Share</Button>
        </div>
      </div>
    </Modal>
  );
}