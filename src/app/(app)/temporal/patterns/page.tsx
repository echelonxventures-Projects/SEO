"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, RefreshCw } from "lucide-react";

type Pattern = { id: string; name: string; dsl: string | null; type: string; freq: string; status: string; version: number; isLibrary: boolean; timezone: string };
type CompileResult = { valid: boolean; compiled: { ast?: unknown; plan?: unknown; diagnostics?: Array<{ level: string; message: string }> } | null; next: Array<{ start: string; end: string }> };

const EXAMPLES = ["EVERY WEEKDAY 09:00", "EVERY 15 MINUTES", "EVERY 30 SECONDS", "FIRST MONDAY OF MONTH", "LAST FRIDAY OF MONTH 16:00", "LAST BUSINESS DAY OF QUARTER", "FIRST WORKING DAY OF YEAR", "EVERY 14 DAYS 15:00 FOR 1 HOURS", "AFTER EVENT(APPROVAL)+7D", "BEFORE EVENT(LAUNCH)-2H", "WHEN RESOURCE_AVAILABLE", "AT SUNRISE", "AFTER FULL_MOON", "+7 DAYS"];

export default function PatternsPage() {
  const [rows, setRows] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dsl, setDsl] = useState("EVERY WEEKDAY 09:30 FOR 30 MINUTES");
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [busyCompile, setBusyCompile] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Pattern[]>("/temporal/patterns").then(setRows).catch((e) => toast("error", e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const runCompile = async (text = dsl) => {
    setBusyCompile(true);
    try {
      setCompile(await api.post<CompileResult>("/temporal/dsl/compile", { dsl: text, horizonDays: 21 }));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Compile failed");
    } finally {
      setBusyCompile(false);
    }
  };

  return (
    <div>
      <PageHeader title="Temporal patterns & DSL studio" description="Reusable temporal assets. Compile the expression, preview the materialized stream, then save — events, calendars and triggers consume the asset." actions={<>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New pattern</Button>
      </>} />

      <Card className="mb-6 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">DSL compiler</p>
        <div className="flex gap-2">
          <Input value={dsl} onChange={(e) => setDsl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runCompile()} className="font-mono" />
          <Button loading={busyCompile} onClick={() => runCompile()}>Compile & preview</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {EXAMPLES.map((ex) => <button key={ex} onClick={() => { setDsl(ex); runCompile(ex); }} className="rounded border border-zinc-200 px-2 py-0.5 font-mono text-[10px] text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">{ex}</button>)}
        </div>
        {compile && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-zinc-400">Diagnostics</p>
              {(compile.compiled?.diagnostics ?? []).length === 0 && <p className="text-xs text-emerald-600">clean</p>}
              {(compile.compiled?.diagnostics ?? []).map((d, i) => (
                <p key={i} className={`text-xs ${d.level === "error" ? "text-red-500" : d.level === "warning" ? "text-amber-500" : "text-zinc-400"}`}>[{d.level}] {d.message}</p>
              ))}
              {compile.compiled?.plan ? <p className="mt-1 text-[10px] text-zinc-400">plan: {JSON.stringify(compile.compiled.plan)}</p> : null}
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-400">Next {compile.next.length} occurrences (UTC)</p>
              <div className="mt-1 max-h-40 overflow-auto rounded border border-zinc-100 dark:border-zinc-800">
                {compile.next.map((o, i) => <div key={i} className="flex justify-between px-2 py-1 text-xs tabular-nums"><span className="text-zinc-500">#{i + 1}</span><span>{o.start.replace("T", " ").slice(0, 16)}</span></div>)}
                {compile.next.length === 0 && <p className="px-2 py-1 text-xs text-zinc-400">trigger/range artifact — no recurrence stream</p>}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <TWrap>
          <thead><tr><Th>Name</Th><Th>DSL</Th><Th>Type</Th><Th>Status</Th><Th>Version</Th><Th>Scope</Th><Th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td className="font-medium">{p.name}</Td>
                <Td><span className="font-mono text-xs text-indigo-600">{p.dsl ?? "(spec)"}</span></Td>
                <Td>{p.type}</Td>
                <Td><Badge className={p.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/15 text-zinc-500"}>{p.status.toLowerCase()}</Badge></Td>
                <Td>v{p.version}</Td>
                <Td>{p.isLibrary ? "platform library" : "workspace"}</Td>
                <Td className="text-right">
                  <button className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={async () => {
                    const prev = await api.get<{ occurrences: Array<{ start: string }> }>(`/temporal/patterns/${p.id}/preview?max=5&days=45`);
                    toast("success", `next: ${prev.occurrences.slice(0, 3).map((o) => o.start.slice(0, 10)).join(", ") || "—"}`);
                  }}>Preview</button>
                  {!p.isLibrary && p.status === "ACTIVE" && (
                    <button className="rounded px-2 py-1 text-xs text-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={async () => { try { await api.post(`/temporal/patterns/${p.id}/deprecate`, {}); toast("success", "Deprecated"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>Deprecate</button>
                  )}
                  {!p.isLibrary && (
                    <button className="rounded px-2 py-1 text-xs text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={async () => { if (!window.confirm("Delete pattern?")) return; try { await api.del(`/temporal/patterns/${p.id}`); toast("success", "Deleted"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>Delete</button>
                  )}
                </Td>
              </tr>
            ))}
            {loading && rows.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400" >loading patterns…</td></tr>}
          </tbody>
        </TWrap>
      </Card>
      {open && <NewPattern dsl={dsl} onClose={() => setOpen(false)} onDone={load} />}
    </div>
  );
}

function NewPattern({ dsl, onClose, onDone }: { dsl: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", dsl, type: "WINDOW", timezone: "Asia/Kolkata", description: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New temporal pattern">
      <div className="grid gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="DSL expression" hint="e.g. EVERY WEEKDAY 09:00 · LAST FRIDAY OF MONTH 16:00 · AFTER EVENT(APPROVAL)+7D"><Input className="font-mono" value={f.dsl} onChange={(e) => setF({ ...f, dsl: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={["WINDOW", "TIME", "DATE", "DATE_RANGE", "TIME_RANGE", "DURATION", "TRIGGER", "CONSTRAINT", "DEPENDENCY", "COMPOSITE"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
          <Field label="Timezone"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        </div>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/temporal/patterns", { name: f.name, dsl: f.dsl, type: f.type, timezone: f.timezone, description: f.description || null });
              toast("success", "Pattern compiled & saved");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Compile & save</Button>
        </div>
      </div>
    </Modal>
  );
}
