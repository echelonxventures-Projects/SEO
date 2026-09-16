"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, RefreshCw, Share2 } from "lucide-react";

type Calendar = { id: string; name: string; code: string; kind: string; visibility: string; timezone: string; color: string; space: string | null; myPermission: string; archivedAt: string | null; _count: { events: number; appointments: number; shares: number }; pattern?: { name: string; dsl: string | null } | null };
type Occ = { id: string; title: string; startsAt: string; endsAt: string; local: string; calendar: { name: string; color: string } };

export default function CalendarsPage() {
  const [rows, setRows] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState<Calendar | null>(null);
  type TItem = { domain: string; id: string; title: string; start: string; color: string };
  const [agenda, setAgenda] = useState<(Occ & { domain?: string })[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Calendar[]>("/temporal/calendars").then(setRows).catch((e) => toast("error", e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    api.get<{ items: Array<TItem & { end: string | null }> }>(`/temporal/timeline`).then((r) => setAgenda(r.items.map((i) => ({ id: `${i.domain}-${i.id}`, eventId: i.id, title: i.title, startsAt: i.start, endsAt: i.end ?? i.start, local: new Date(i.start).toISOString().slice(11, 16), calendar: { name: i.domain, color: i.color } })))).catch(() => undefined);
  }, [load]);

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  return (
    <div>
      <PageHeader title="Calendars" description="Workspaces of time — teams, resources, projects. Sharing, security and a two-week materialized agenda." actions={<>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New calendar</Button>
      </>} />

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

      <CardHeader title="14-day agenda" description="Every confirmed occurrence across calendars you can see" />
      <div className="overflow-x-auto rounded-xl border">
        <div className="flex min-w-max">
          {days.map((day) => (
            <div key={day} className="w-40 shrink-0 border-r border-zinc-100 p-2 last:border-r-0 dark:border-zinc-800">
              <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-400">{new Date(`${day}T00:00:00Z`).toUTCString().slice(0, 10)}</p>
              {agenda.filter((o) => o.startsAt.slice(0, 10) === day).slice(0, 6).map((o) => (
                <div key={o.id} className="mb-1 rounded px-1.5 py-1 text-[11px]" style={{ background: `${o.calendar.color}18`, color: o.calendar.color, borderLeft: `2px solid ${o.calendar.color}` }} title={`${o.title} · ${o.calendar.name}`}>
                  <span className="tabular-nums">{o.local}</span> {o.title}
                </div>
              ))}
            </div>
          ))}
        </div>
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
              {sh.permission !== "MANAGE" || true ? (
                <button className="text-xs text-red-500 hover:underline" onClick={async () => { try { await api.del(`/temporal/calendars/${cal.id}/shares/${sh.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>remove</button>
              ) : null}
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
