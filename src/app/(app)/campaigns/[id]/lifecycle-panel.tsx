"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Input, Select, TWrap, Th, Td } from "@/components/ui";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";

type Orchestration = {
  lifecycle: string;
  composition: Record<string, unknown> | null;
  timestamps: Record<string, string | null>;
  offers: Array<{ offer: { code: string; name: string; status: string } }>;
  allowedTransitions: string[];
  learnings: { summary: Record<string, unknown>; learnings: { wins: unknown[]; watchouts: unknown[] } } | null;
};
type Channels = Array<{ id: string; name: string; ready: boolean }>;
type Audiences = Array<{ id: string; name: string; _count: { members: number } }>;

const STAGES = ["DRAFT", "PLANNED", "PENDING_APPROVAL", "APPROVED", "LIVE", "CLOSED", "LEARNED"] as const;

export function LifecyclePanel({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [o, setO] = useState<Orchestration | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sim, setSim] = useState<Record<string, unknown> | null>(null);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(() => {
    api.get<Orchestration>(`/campaigns/${campaignId}/orchestration`).then(setO).catch(() => {});
  }, [campaignId]);
  useEffect(load, [load]);

  const idx = o ? STAGES.indexOf(o.lifecycle as (typeof STAGES)[number]) : -1;

  async function transition(to: string) {
    setBusy(to);
    try {
      await api.post(`/campaigns/${campaignId}/transition`, { to });
      toast("success", `Campaign → ${to.toLowerCase()}`);
      load();
      router.refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(null);
    }
  }

  const ACTION_LABEL: Record<string, string> = {
    PENDING_APPROVAL: "Request approval",
    APPROVED: "Approve",
    LIVE: "🚀 Launch",
    CLOSED: "Close campaign",
    LEARNED: "Generate learnings",
  };

  return (
    <Card>
      <CardHeader
        title="Orchestration"
        description="Plan → approve → launch → close → learn. The orchestrator references domain resources; it owns none."
        actions={
          o && (idx <= 1) && (
            <Button size="sm" variant="outline" onClick={() => setPlanning((v) => !v)}>{planning ? "Close planner" : "Plan composition"}</Button>
          )
        }
      />
      <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", i < idx ? "bg-emerald-500/15 text-emerald-600" : i === idx ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800")}>{s}</span>
            {i < STAGES.length - 1 && <span className="text-zinc-300">›</span>}
          </div>
        ))}
      </div>

      {o && idx >= 1 && o.composition && (
        <div className="grid gap-3 border-b border-zinc-100 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
          <Kv k="Objective" v={String((o.composition as { objective?: string }).objective ?? "—")} />
          <Kv k="Channels" v={(o.composition as { channels?: Array<{ name: string }> }).channels?.map((c) => c.name).join(", ") ?? "—"} />
          <Kv k="Window" v={`${fmtDate(String((o.composition as { startsAt?: string }).startsAt))} → ${fmtDate(String((o.composition as { endsAt?: string }).endsAt))}`} />
          <Kv k="Budget" v={fmtMoney(Number((o.composition as { budgetMinor?: number }).budgetMinor ?? 0))} />
          {o.offers.length > 0 && <Kv k="Offers" v={o.offers.map((x) => x.offer.code).join(", ")} />}
        </div>
      )}

      {planning && o && <Planner campaignId={campaignId} onDone={() => { setPlanning(false); load(); }} />}

      <div className="flex flex-wrap items-center gap-2 p-4">
        {o?.allowedTransitions.filter((t) => t !== "DRAFT").map((t) => (
          <Button key={t} size="sm" variant={t === "LIVE" ? "primary" : "secondary"} loading={busy === t} onClick={() => transition(t)}>
            {ACTION_LABEL[t] ?? t}
          </Button>
        ))}
        {o && idx >= 1 && idx < 4 && (
          <Button size="sm" variant="outline" loading={busy === "sim"} onClick={async () => {
            setBusy("sim");
            try { setSim(await api.post(`/campaigns/${campaignId}/simulate`)); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
          }}>
            Simulate
          </Button>
        )}
        {!o?.allowedTransitions.length && o && <p className="text-sm text-zinc-400">Lifecycle complete — this campaign has learned.</p>}
      </div>

      {sim && (
        <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Simulation — {String((sim as { method?: string }).method)}</p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["reach", "clicks", "conversions", "estRevenueMinor"] as const).map((k) => (
              <div key={k} className="rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800/40">
                <p className="text-[11px] text-zinc-500">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</p>
                <p className="font-semibold">{k === "estRevenueMinor" ? fmtMoney(Number((sim as { totals: Record<string, number> }).totals[k])) : String((sim as { totals: Record<string, number> }).totals[k])}</p>
              </div>
            ))}
          </div>
          <TWrap>
            <thead><tr><Th>Channel</Th><Th>Reach</Th><Th>Clicks</Th><Th>Conv.</Th><Th>Est. spend</Th></tr></thead>
            <tbody>
              {(sim as { channels: Array<{ channel: string; reach: number; clicks: number; conversions: number; estSpendMinor: number }> }).channels.map((c) => (
                <tr key={c.channel}><Td>{c.channel}</Td><Td>{c.reach.toLocaleString("en-IN")}</Td><Td>{c.clicks.toLocaleString("en-IN")}</Td><Td>{c.conversions}</Td><Td>{fmtMoney(c.estSpendMinor)}</Td></tr>
              ))}
            </tbody>
          </TWrap>
          <p className="mt-2 text-[11px] text-zinc-400">{String((sim as { note?: string }).note)}</p>
        </div>
      )}

      {o?.learnings && (
        <div className="grid gap-3 border-t border-zinc-100 p-4 dark:border-zinc-800 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-emerald-600">Wins</p>
            {((o.learnings.learnings as { wins: string[] }).wins ?? []).map((w) => <p key={w} className="text-sm">✓ {w}</p>)}
            <p className="mt-2 text-xs text-zinc-400">{JSON.stringify(o.learnings.summary?.roas ?? null) !== "null" ? `Final ROAS: ${Number(o.learnings.summary?.roas ?? 0).toFixed(2)}× · ${Number(o.learnings.summary?.spendMinor ?? 0) / 100} spent` : ""}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-amber-600">Watch-outs</p>
            {((o.learnings.learnings as { watchouts: string[] }).watchouts ?? []).map((w) => <p key={w} className="text-sm">⚠ {w}</p>)}
          </div>
        </div>
      )}
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{k}</p>
      <p className="font-medium">{v}</p>
    </div>
  );
}

function Planner({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const [channels, setChannels] = useState<Channels>([]);
  const [audiences, setAudiences] = useState<Audiences>([]);
  const [f, setF] = useState({ objective: "", channelIds: [] as string[], audienceId: "", startsAt: new Date().toISOString().slice(0, 10), endsAt: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), budget: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<Channels>("/channels").then(setChannels).catch(() => {});
    api.get<Audiences>("/audiences").then(setAudiences).catch(() => {});
  }, []);
  return (
    <div className="border-b border-zinc-100 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-800/20">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Objective
          <Input value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} placeholder="Book 40 demo calls this quarter" className="mt-1" />
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Audience
          <Select className="mt-1" value={f.audienceId} onChange={(e) => setF({ ...f, audienceId: e.target.value })} options={[{ value: "", label: "Open reach" }, ...audiences.map((a) => ({ value: a.id, label: `${a.name} (${a._count.members})` }))]} />
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Window
          <span className="mt-1 flex gap-2">
            <Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
            <Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </span>
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Total budget
          <Input type="number" min="0" className="mt-1" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        </label>
      </div>
      <p className="mb-1 mt-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">Channels</p>
      <div className="flex flex-wrap gap-1.5">
        {channels.map((c) => (
          <button key={c.id} disabled={!c.ready} onClick={() => setF((cur) => ({ ...cur, channelIds: cur.channelIds.includes(c.id) ? cur.channelIds.filter((x) => x !== c.id) : [...cur.channelIds, c.id] }))}
            className={cn("rounded-lg border px-2.5 py-1 text-xs", f.channelIds.includes(c.id) ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700", !c.ready && "cursor-not-allowed opacity-40")}>
            {c.name}{!c.ready && " ⚠"}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" loading={busy} onClick={async () => {
          if (!f.objective || !f.channelIds.length || !f.budget) { toast("error", "Objective, channels and budget are required"); return; }
          setBusy(true);
          try {
            await api.post(`/campaigns/${campaignId}/plan`, {
              objective: f.objective, channelIds: f.channelIds, audienceId: f.audienceId || null,
              contentPostIds: [], offerIds: [], startsAt: f.startsAt, endsAt: f.endsAt, budget: Number(f.budget), rules: {},
            });
            toast("success", "Composition planned & validated");
            onDone();
          } catch (e) {
            toast("error", e instanceof Error ? e.message : "Plan rejected");
            setBusy(false);
          }
        }}>Save plan</Button>
      </div>
    </div>
  );
}
