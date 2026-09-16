"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, TWrap, Th, Td, Checkbox } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";

export type Flight = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  budgetMinor: number | bigint | null;
  slotsGenerated: number;
  cadence: { days?: number[]; time?: string } | null;
  pattern?: { id: string; name: string; dsl: string | null } | null;
  channel: { id: string; code: string; name: string; kind: string };
  audience: { id: string; name: string } | null;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function FlightsPanel({
  campaignId,
  flights,
  permissions,
}: {
  campaignId: string;
  flights: Flight[];
  permissions: string[];
}) {
  const router = useRouter();
  const canWrite = permissions.includes("campaign.write");
  const [channels, setChannels] = useState<Array<{ id: string; name: string; kind: string; ready: boolean }>>([]);
  const [audiences, setAudiences] = useState<Array<{ id: string; name: string; _count: { members: number } }>>([]);
  const [open, setOpen] = useState(false);

  async function act(path: string, body?: unknown) {
    try {
      const r = await api.post<{ created?: number }>(path, body ?? {});
      toast("success", r?.created != null ? `${r.created} post slots scheduled` : "Done");
      router.refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Calendar flights"
        description="One flight per channel; approval + cadence drive publishing"
        actions={canWrite && (
          <Button
            size="sm"
            onClick={async () => {
              if (!channels.length) {
                api.get<Array<{ id: string; name: string; kind: string; ready: boolean }>>("/channels").then((r) => setChannels(r.filter((c) => c.ready))).catch(() => {});
                api.get<Array<{ id: string; name: string; _count: { members: number } }>>("/audiences").then(setAudiences).catch(() => {});
              }
              setOpen(true);
            }}
          >
            Add flight
          </Button>
        )}
      />
      <TWrap>
        <thead><tr><Th>Channel</Th><Th>Window</Th><Th>Audience</Th><Th>Budget</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
        <tbody>
          {flights.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">No flights yet — use the guided wizard or add one.</td></tr>}
          {flights.map((f) => (
            <tr key={f.id}>
              <Td><p className="font-medium">{f.channel.name}</p><p className="text-xs text-zinc-400">{f.channel.kind.toLowerCase()}</p></Td>
              <Td className="text-zinc-500">{fmtDate(f.startsAt)} → {fmtDate(f.endsAt)}{f.pattern ? <div className="mt-0.5 font-mono text-[10px] text-indigo-500" title={f.pattern.name}>{f.pattern.dsl ?? f.pattern.name}</div> : null}</Td>
              <Td>{f.audience ? <Link href={`/audiences/${f.audience.id}`} className="text-sky-600 hover:underline">{f.audience.name}</Link> : <span className="text-zinc-400">—</span>}</Td>
              <Td>{f.budgetMinor != null ? fmtMoney(Number(f.budgetMinor)) : "—"}</Td>
              <Td><StatusBadge value={f.status} /></Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1.5">
                  {f.status === "DRAFT" && canWrite && (
                    <button onClick={() => act(`/flights/${f.id}/approve`)} className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">Approve</button>
                  )}
                  {["APPROVED", "LIVE", "PAUSED"].includes(f.status) && (f.cadence || f.pattern) && canWrite && (
                    <button onClick={() => act(`/flights/${f.id}/slots`)} className="rounded px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950" title={f.pattern ? `temporal asset: ${f.pattern.dsl ?? f.pattern.name}` : "cadence will be adopted into a temporal asset"}>Generate slots ({f.slotsGenerated})</button>
                  )}
                  {!["ENDED", "CANCELLED"].includes(f.status) && canWrite && (
                    <button onClick={() => act(`/flights/${f.id}/cancel`)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Cancel</button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TWrap>
      {open && (
        <AddFlightModal
          campaignId={campaignId}
          channels={channels}
          audiences={audiences}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </Card>
  );
}

function AddFlightModal({
  campaignId,
  channels,
  audiences,
  onClose,
  onDone,
}: {
  campaignId: string;
  channels: Array<{ id: string; name: string; kind: string; ready: boolean }>;
  audiences: Array<{ id: string; name: string; _count: { members: number } }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    channelId: "",
    audienceId: "",
    startsAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
    endsAt: new Date(Date.now() + 31 * 86400_000).toISOString().slice(0, 10),
    budget: "",
    patternId: "",
    cadence: false,
    days: [1, 3, 5] as number[],
    time: "10:00",
  });
  const [patterns, setPatterns] = useState<Array<{ id: string; name: string; dsl: string | null }>>([]);
  useEffect(() => { api.get<Array<{ id: string; name: string; dsl: string | null; status: string }>>("/temporal/patterns").then((p) => setPatterns(p.filter((x) => x.status === "ACTIVE"))).catch(() => undefined); }, []);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add flight">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <Select value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} options={[{ value: "", label: "Select…" }, ...channels.map((c) => ({ value: c.id, label: c.name }))]} />
          </Field>
          <Field label="Audience"><Select value={f.audienceId} onChange={(e) => setF({ ...f, audienceId: e.target.value })} options={[{ value: "", label: "None" }, ...audiences.map((a) => ({ value: a.id, label: `${a.name} (${a._count.members})` }))]} /></Field>
          <Field label="Starts"><Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label="Ends"><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <Field label="Channel budget (optional)"><Input type="number" min="0" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></Field>
        <Field label="Cadence — temporal asset (recommended)" hint="A reusable UTP pattern; edit it once, every consuming flight follows">
          <Select value={f.patternId} onChange={(e) => setF({ ...f, patternId: e.target.value, cadence: false })} options={[{ value: "", label: f.cadence ? "— legacy weekly picker —" : "None (no posting slots)" }, ...patterns.map((p) => ({ value: p.id, label: `${p.name} · ${p.dsl ?? ""}` }))]} />
        </Field>
        {!f.patternId && (
        <div>
          <Checkbox label="Legacy weekly cadence (auto-adopted into a temporal asset on first slot run)" checked={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.checked })} />
          {f.cadence && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {DAY_LABELS.map((d, i) => (
                <button key={d} onClick={() => setF((c) => ({ ...c, days: c.days.includes(i) ? c.days.filter((x) => x !== i) : [...c.days, i] }))} className={`rounded border px-2 py-0.5 text-xs ${c_days(f.days, i) ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 text-zinc-500"}`}>{d}</button>
              ))}
              <Input type="time" className="ml-2 w-28" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            </div>
          )}
        </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!f.channelId) { toast("error", "Pick a channel"); return; }
            setBusy(true);
            try {
              const r = await api.post<{ warnings?: string[] }>("/flights", {
                campaignId,
                channelId: f.channelId,
                audienceId: f.audienceId || null,
                startsAt: f.startsAt,
                endsAt: f.endsAt,
                budget: f.budget ? Number(f.budget) : null,
                patternId: f.patternId || null,
                cadence: !f.patternId && f.cadence ? { days: f.days, time: f.time } : null,
              });
              (r?.warnings ?? []).forEach((w) => toast("info", w));
              toast("success", "Flight created");
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Create flight</Button>
        </div>
      </div>
    </Modal>
  );
}

function c_days(arr: number[], i: number) {
  return arr.includes(i);
}
