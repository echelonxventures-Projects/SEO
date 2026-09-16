"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";

type LogRow = { id: string; type: string; aggregateType: string; aggregateId: string; seq: number; at: string; payload: Record<string, unknown> };

export default function GovernancePage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [entityType, setEntityType] = useState("EVENT");
  const [entityId, setEntityId] = useState("");
  const [at, setAt] = useState("");
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.get<LogRow[]>("/temporal/governance/events").then(setRows).catch((e) => toast("error", e.message));
  }, []);

  const doReplay = async () => {
    try {
      setReplay(await api.get(`/temporal/governance/replay/${entityType}/${entityId}${at ? `?at=${encodeURIComponent(new Date(at).toISOString())}` : ""}`));
    } catch (e) { toast("error", e instanceof Error ? e.message : "Replay failed"); }
  };

  return (
    <div>
      <PageHeader title="Temporal governance" description="Immutable event store — audit, compliance, replay, time-travel and retention for every temporal aggregate." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <CardHeader title="Replay / time travel" description="Fold an aggregate forward through its event log, or fetch its state at a moment." />
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aggregate type"><Select value={entityType} onChange={(e) => setEntityType(e.target.value)} options={["EVENT", "PATTERN", "CALENDAR", "APPOINTMENT", "RESOURCE", "TRIGGER", "RULE"].map((v) => ({ value: v, label: v }))} /></Field>
              <Field label="As-of (optional)"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
            </div>
            <div className="mt-2 flex gap-2">
              <Input className="font-mono" placeholder="aggregate id (click a log row to copy)" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
              <Button onClick={doReplay}>Replay</Button>
            </div>
            {replay && (
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-zinc-50 p-3 font-mono text-[10px] leading-relaxed dark:bg-zinc-900">
                {JSON.stringify({ mode: replay.mode, eventCount: (replay.trail as unknown[])?.length ?? null, state: replay.mode === "time_travel" ? replay.state : replay.state, trail: (replay.trail as Array<{ seq: number; type: string }>)?.slice(0, 30) }, null, 2)}
              </pre>
            )}
          </Card>
        </div>
        <div>
          <CardHeader title="Event store" description={`Append-only — ${rows.length} recent`} />
          <Card className="max-h-[420px] overflow-auto">
            <TWrap>
              <thead><tr><Th>Seq</Th><Th>Type</Th><Th>Aggregate</Th><Th>At</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-copy border-t border-zinc-100 dark:border-zinc-800" title={`${r.aggregateId} — click row to copy id`}>
                    <Td className="tabular-nums text-xs"><button className="text-indigo-600 hover:underline" onClick={() => { setEntityId(r.aggregateId); setEntityType(r.aggregateType); navigator.clipboard?.writeText(r.aggregateId).catch(() => undefined); }}>{r.seq}</button></Td>
                    <Td><Badge className="bg-indigo-500/10 text-indigo-600">{r.type}</Badge></Td>
                    <Td className="font-mono text-[10px]">{r.aggregateType}:{r.aggregateId.slice(-6)}</Td>
                    <Td className="tabular-nums text-xs text-zinc-500">{new Date(r.at).toUTCString().slice(5, 22)}</Td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400">Event store empty — mutations will append here.</td></tr>}
              </tbody>
            </TWrap>
          </Card>
        </div>
      </div>
      <StreamsCard />
    </div>
  );
}

function StreamsCard() {
  type Tr = { id: string; name: string; url: string; eventMatch: string; active: boolean; scope: string; sentCount: number; failCount: number; lastError: string | null; lastSentAt: string | null };
  const [rows, setRows] = useState<Tr[]>([]);
  const [f, setF] = useState({ name: "", url: "", eventMatch: "*", platform: false });
  const [secret, setSecret] = useState<string | null>(null);
  const load = useCallback(() => { api.get<Tr[]>("/temporal/stream/transports").then(setRows).catch(() => undefined); }, []);
  useEffect(load, [load]);
  return (
    <div className="mt-6">
      <CardHeader title="Event-stream fabrics" description="The TemporalEventLog streamed to external sinks (Kafka/Pulsar bridges) — HMAC-signed, cursor-resumable, auto-pausing" />
      <Card className="p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ops Kafka bridge" /></Field>
          <Field label="Sink URL"><Input className="font-mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://bridge.example/events" /></Field>
          <Field label="Event match"><Input className="font-mono" value={f.eventMatch} onChange={(e) => setF({ ...f, eventMatch: e.target.value })} placeholder="Appointment*" /></Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Checkbox label="Platform fabric (all workspaces)" checked={f.platform} onChange={(e) => setF({ ...f, platform: e.target.checked })} />
            <Button size="sm" onClick={async () => {
              try { const r = await api.post<{ transport: { id: string }; secret: string }>("/temporal/stream/transports", f); setSecret(r.secret); toast("success", "Created (inactive) — copy the secret, shown once"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            }}>Add transport</Button>
          </div>
        </div>
        {secret && <p className="mt-2 break-all rounded bg-zinc-50 p-2 font-mono text-[10px] dark:bg-zinc-900">HMAC secret (one-time): {secret}</p>}
        <div className="mt-3 divide-y">
          {rows.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{t.name}</span>
                <Badge className={t.active ? "bg-emerald-500/15 text-emerald-600 ml-2" : "bg-zinc-500/15 text-zinc-500 ml-2"}>{t.active ? "streaming" : t.url.includes("REPLACE-ME") ? "blank — fill URL to activate" : "inactive"}</Badge>
                <span className="ml-2 font-mono text-[10px] text-zinc-400">{t.scope} · {t.eventMatch} · {t.sentCount} pushed{t.failCount ? ` · ${t.failCount} fails` : ""}</span>
                {t.lastError && <span className="ml-2 text-[10px] text-red-500">{t.lastError.slice(0, 40)}</span>}
              </div>
              <div className="flex gap-1">
                <button className="text-xs text-indigo-600 hover:underline" onClick={async () => { try { await api.post(`/temporal/stream/transports/${t.id}/toggle`, { active: !t.active }); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>{t.active ? "pause" : "activate"}</button>
                <button className="text-xs text-zinc-500 hover:underline" onClick={async () => { try { await api.post(`/temporal/stream/transports/${t.id}/reset`, { from: "1970-01-01T00:00:00Z" }); toast("success", "Cursor rewound to epoch"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>rewind</button>
                <button className="text-xs text-red-500 hover:underline" onClick={async () => { if (window.confirm(`Delete transport ${t.name}?`)) { try { await api.del(`/temporal/stream/transports/${t.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } } }}>delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
