"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toast } from "@/components/toast";

type Channel = { id: string; code: string; name: string; kind: string; ready: boolean; orgId: string | null };
type Audience = { id: string; name: string; kind: string; _count: { members: number }; client: { name: string } | null };
type ClientRow = { id: string; name: string };

const STEPS = ["1 · Client", "2 · Channels", "3 · Audience", "4 · Schedule"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [form, setForm] = useState({
    name: "",
    clientId: "",
    channelIds: [] as string[],
    audienceId: "",
    startsAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
    endsAt: new Date(Date.now() + 31 * 86400_000).toISOString().slice(0, 10),
    budget: "",
    cadenceDays: [1, 3, 5] as number[],
    cadenceTime: "10:00",
    withCadence: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Channel[]>("/channels").then(setChannels).catch(() => {});
    api.get<Audience[]>("/audiences").then(setAudiences).catch(() => {});
    api.get<{ rows: ClientRow[] }>("/clients?pageSize=200").then((r) => setClients(r.rows)).catch(() => {});
  }, []);

  const canNext = useMemo(() => {
    if (step === 0) return form.name.trim().length >= 2;
    if (step === 1) return form.channelIds.length > 0;
    return true;
  }, [step, form]);

  const socialSelected = form.channelIds.some((id) => channels.find((c) => c.id === id)?.kind === "SOCIAL" || channels.find((c) => c.id === id)?.kind === "VIDEO");

  async function finish() {
    setBusy(true);
    try {
      const c = await api.post<{ id: string }>("/campaigns/wizard", {
        name: form.name.trim(),
        clientId: form.clientId || null,
        channelIds: form.channelIds,
        audienceId: form.audienceId || null,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        budget: form.budget ? Number(form.budget) : null,
        cadence: form.withCadence && socialSelected ? { days: form.cadenceDays, time: form.cadenceTime } : null,
      });
      toast("success", "Campaign created with flights on the calendar");
      router.push(`/campaigns/${c.id}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Guided campaign" description="Client → channels → audience → schedule. Each step is its own system; this is how they compose." />
      <div className="mb-4 flex gap-2">
        {STEPS.map((label, i) => (
          <button key={label} onClick={() => i < step && setStep(i)} className={cn("flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium", i === step ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : i < step ? "border-emerald-300 text-emerald-600" : "border-zinc-200 text-zinc-400 dark:border-zinc-700")}>
            {label}
          </button>
        ))}
      </div>
      <Card className="p-5">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Campaign name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Diwali growth push 2026" /></Field>
            <Field label="Client" hint="Skip for the workspace's own campaigns (self-serve / house brand)">
              <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} options={[{ value: "", label: "House campaign (no client)" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
            </Field>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="mb-3 text-xs text-zinc-500">Pick one or more channels — greyed out ones still need a connected account.</p>
            <div className="grid grid-cols-2 gap-2">
              {channels.map((c) => (
                <button
                  key={c.id}
                  disabled={!c.ready}
                  onClick={() => setForm((f) => ({ ...f, channelIds: f.channelIds.includes(c.id) ? f.channelIds.filter((x) => x !== c.id) : [...f.channelIds, c.id] }))}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm",
                    form.channelIds.includes(c.id) && "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900 dark:border-white dark:bg-zinc-800 dark:ring-white",
                    !c.ready && "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-medium">{c.name}</span>
                    {!c.ready && <Badge className="bg-amber-500/15 text-amber-600">needs account</Badge>}
                  </span>
                  <span className="text-xs text-zinc-400">{c.kind.toLowerCase()} · {c.orgId ? "workspace" : "platform"}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <Field label="Target audience" hint="Audiences are their own product — create/manage under Audiences">
              <Select value={form.audienceId} onChange={(e) => setForm({ ...form, audienceId: e.target.value })} options={[{ value: "", label: "No audience (open reach)" }, ...audiences.map((a) => ({ value: a.id, label: `${a.name} — ${a._count.members.toLocaleString("en-IN")} members` }))]} />
            </Field>
            {form.audienceId && (
              <p className="text-xs text-zinc-500">Attached to every flight. Members carry per-contact consent.</p>
            )}
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Flight starts"><Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
              <Field label="Flight ends"><Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
            </div>
            <Field label="Total budget (optional)"><Input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="₹" /></Field>
            {socialSelected && (
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <Checkbox label="Auto-generate social post slots on a weekly cadence" checked={form.withCadence} onChange={(e) => setForm({ ...form, withCadence: e.target.checked })} />
                {form.withCadence && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {DAY_LABELS.map((d, i) => (
                      <button key={d} onClick={() => setForm((f) => ({ ...f, cadenceDays: f.cadenceDays.includes(i) ? f.cadenceDays.filter((x) => x !== i) : [...f.cadenceDays, i] }))} className={cn("rounded-md border px-2.5 py-1 text-xs", form.cadenceDays.includes(i) ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 text-zinc-500 dark:border-zinc-700")}>{d}</button>
                    ))}
                    <Input type="time" value={form.cadenceTime} onChange={(e) => setForm({ ...form, cadenceTime: e.target.value })} className="w-28" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Back</Button>
          {step < 3 ? (
            <Button onClick={() => canNext && setStep((s) => s + 1)}>Next →</Button>
          ) : (
            <Button loading={busy} onClick={finish}>Create campaign</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
