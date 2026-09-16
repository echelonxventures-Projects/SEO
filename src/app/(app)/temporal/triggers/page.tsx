"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, RefreshCw } from "lucide-react";

type Trigger = { id: string; name: string; anchorType: string; dsl: string | null; consumerType: string; status: string; nextFireAt: string | null; lastFiredAt: string | null; firedCount: number; maxFires: number | null; pattern: { name: string; dsl: string | null } | null; _count: { fires: number } };
type Fire = { id: string; firedAt: string; outcome: string; detail: { steps?: Array<{ stage: string; status: string }> } };

export default function TriggersPage() {
  const [rows, setRows] = useState<Trigger[]>([]);
  const [open, setOpen] = useState(false);
  const [fires, setFires] = useState<Fire[] | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; subjectType: string; consumerType: string; status: string; steps: Array<{ stage: string; status: string }>; plannedAt: string }>>([]);

  const load = useCallback(() => {
    api.get<Trigger[]>("/temporal/triggers").then(setRows).catch((e) => toast("error", e.message));
    api.get<typeof plans>("/temporal/executions").then(setPlans).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader title="Temporal triggers" description="Time, event, astronomical and resource-conditioned automations routed through the universal execution pipeline." actions={<>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New trigger</Button>
      </>} />

      <Card className="mb-6">
        <TWrap>
          <thead><tr><Th>Name</Th><Th>Anchor</Th><Th>DSL</Th><Th>Consumer</Th><Th>Status</Th><Th>Next fire (UTC)</Th><Th>Fires</Th><Th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td className="font-medium">{t.name}</Td>
                <Td><Badge className="bg-indigo-500/10 text-indigo-600">{t.anchorType.replace(/_/g, " ").toLowerCase()}</Badge></Td>
                <Td><span className="font-mono text-xs text-zinc-500">{t.pattern ? `⏱ ${t.pattern.dsl ?? t.pattern.name}` : t.dsl ?? "—"}</span></Td>
                <Td>{t.consumerType.toLowerCase()}</Td>
                <Td><Badge className={t.status === "ARMED" ? "bg-emerald-500/15 text-emerald-600" : t.status === "EXHAUSTED" ? "bg-zinc-500/15 text-zinc-500" : "bg-amber-500/15 text-amber-600"}>{t.status.toLowerCase()}</Badge></Td>
                <Td className="tabular-nums text-xs">{t.nextFireAt ? new Date(t.nextFireAt).toUTCString().slice(5, 22) : "—"}</Td>
                <Td className="tabular-nums text-xs">{t.firedCount}{t.maxFires ? `/${t.maxFires}` : ""}</Td>
                <Td className="text-right whitespace-nowrap">
                  <button className="text-xs text-zinc-500 hover:underline" onClick={async () => { setFires(null); try { setFires(await api.get<Fire[]>(`/temporal/triggers/${t.id}/fires`)); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>fires</button>
                  <button className="ml-2 text-xs hover:underline" onClick={async () => { try { await api.post(`/temporal/triggers/${t.id}/toggle`, { active: t.status !== "ARMED" }); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>{t.status === "ARMED" ? "pause" : "arm"}</button>
                </Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400">No triggers armed.</td></tr>}
          </tbody>
        </TWrap>
      </Card>

      {fires !== null && (
        <div>
          <CardHeader title="Trigger fire history" actions={<Button size="sm" variant="ghost" onClick={() => setFires(null)}>close</Button>} />
          <Card className="mb-6">
            {fires.map((f) => (
              <div key={f.id} className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-b-0 dark:border-zinc-800">
                <span className="tabular-nums text-xs text-zinc-500">{new Date(f.firedAt).toUTCString().slice(5, 22)}</span>
                <span className="text-xs">{f.detail?.steps?.map((s) => `${s.stage}:${s.status}`).join(" → ")}</span>
                <Badge className={f.outcome === "SUCCESS" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500"}>{f.outcome.toLowerCase()}</Badge>
              </div>
            ))}
            {fires.length === 0 && <p className="p-4 text-sm text-zinc-400">Has not fired yet.</p>}
          </Card>
        </div>
      )}

      <CardHeader title="Execution pipeline plans" description="validation → constraints → dependencies → availability → trigger → plan → execute" />
      <Card>
        {plans.slice(0, 12).map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-b-0 dark:border-zinc-800">
            <span className="text-xs text-zinc-400 tabular-nums">{new Date(p.plannedAt).toUTCString().slice(5, 22)}</span>
            <span className="text-xs">{p.subjectType} → {p.consumerType.toLowerCase()}</span>
            <span className="font-mono text-[10px] text-zinc-500">{p.steps.map((s) => `${s.stage[0]}${s.status === "done" ? "✓" : s.status === "failed" ? "✗" : "…"}`).join(" ")}</span>
            <Badge className={p.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500"}>{p.status.toLowerCase()}</Badge>
          </div>
        ))}
        {plans.length === 0 && <p className="p-4 text-sm text-zinc-400">Run the temporal-triggers cron (or arm one due now) to see plans.</p>}
      </Card>

      {open && <NewTrigger onClose={() => setOpen(false)} onDone={load} />}
    </div>
  );
}

function NewTrigger({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", anchorType: "RELATIVE", dsl: "", consumerType: "MONITORING", offsetMinutes: "60", projectId: "", title: "", patternId: "" });
  const [patterns, setPatterns] = useState<Array<{ id: string; name: string; dsl: string | null }>>([]);
  useEffect(() => { api.get<Array<{ id: string; name: string; dsl: string | null; status: string; freq: string }>>("/temporal/patterns").then((p) => setPatterns(p.filter((x) => x.status === "ACTIVE" && x.freq !== "NONE"))).catch(() => undefined); }, []);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ id: string; name: string }[]>("/projects?pageSize=50").then(setProjects).catch(() => undefined); }, []);
  const anchor: Record<string, unknown> = {};
  if (f.anchorType === "RELATIVE") anchor.offsetMinutes = Number(f.offsetMinutes);
  if (f.anchorType === "ASTRONOMICAL") { anchor.astroEvent = "SUNRISE"; anchor.lat = 19.076; anchor.lng = 72.8777; }
  if (f.anchorType === "ABSOLUTE") anchor.at = new Date(Date.now() + 3600_000).toISOString();
  if (f.consumerType === "WORKFLOW") { anchor.projectId = f.projectId || null; anchor.title = f.title || `${f.name} — action`; }
  if (f.consumerType === "NOTIFICATION") { anchor.email = "founder@aithink.india"; anchor.subject = f.name; anchor.body = "Temporal reminder"; }
  return (
    <Modal open onClose={onClose} title="New temporal trigger">
      <div className="grid gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Anchor"><Select value={f.anchorType} onChange={(e) => setF({ ...f, anchorType: e.target.value })} options={["RELATIVE", "ABSOLUTE", "EVENT_BEFORE", "EVENT_AFTER", "ASTRONOMICAL", "RESOURCE_AVAILABLE", "CAPACITY_AVAILABLE", "CUSTOM"].map((v) => ({ value: v, label: v.toLowerCase().replace(/_/g, " ") }))} /></Field>
          <Field label="Consumer"><Select value={f.consumerType} onChange={(e) => setF({ ...f, consumerType: e.target.value })} options={["MONITORING", "WORKFLOW", "NOTIFICATION", "WEBHOOK", "CONTENT", "BILLING", "CAMPAIGN", "AI_AGENT", "AUTOMATION"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
        </div>
        <Field label="Ride a temporal asset (optional)" hint="Recurring pattern wins over one-shot anchors">
          <Select value={f.patternId} onChange={(e) => setF({ ...f, patternId: e.target.value })} options={[{ value: "", label: "— none —" }, ...patterns.map((p) => ({ value: p.id, label: `${p.name} · ${p.dsl ?? ""}` }))]} />
        </Field>
        <Field label="DSL (optional — overrides anchor math)"><Input className="font-mono" value={f.dsl} onChange={(e) => setF({ ...f, dsl: e.target.value })} placeholder="AT SUNRISE" /></Field>
        {f.anchorType === "RELATIVE" && <Field label="Offset minutes from now"><Input type="number" value={f.offsetMinutes} onChange={(e) => setF({ ...f, offsetMinutes: e.target.value })} /></Field>}
        {f.consumerType === "WORKFLOW" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} options={[{ value: "", label: "—" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} /></Field>
            <Field label="Task title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/temporal/triggers", { name: f.name, anchorType: f.anchorType, dsl: f.dsl || null, consumerType: f.consumerType, patternId: f.patternId || null, anchor });
              toast("success", "Trigger armed");
              onDone();
              onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Arm trigger</Button>
        </div>
      </div>
    </Modal>
  );
}
