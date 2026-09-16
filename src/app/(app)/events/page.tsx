"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { toast } from "@/components/toast";
import { Plus, Radio } from "lucide-react";

type Ev = { id: string; type: string; aggregateType: string; aggregateId: string; occurredAt: string; payload: Record<string, unknown> };
type Sub = { id: string; eventMatch: string; url: string; label: string; active: boolean; failCount: number; lastError: string | null; orgScoped: boolean };
type Delivery = { id: string; status: string; attempts: number; responseCode: number | null; error: string | null; at: string; event: { type: string } };

export default function EventsPage() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<{ sub: Sub; rows: Delivery[] } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<Ev[]>("/events"),
      api.get<Sub[]>("/events/subscriptions"),
    ])
      .then(([e, s]) => { setEvents(e); setSubs(s); })
      .catch((x) => toast("error", x.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader
        title="Events & webhooks"
        description="The domain event spine (§13). Everything emits; external systems subscribe — HMAC-SHA256 signed, 3 retries."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Subscribe</Button>}
      />

      <Card className="mb-4">
        <CardHeader title="Subscriptions" description="Domain events fan out to these endpoints via the dispatcher cron" />
        {subs.length === 0 ? (
          <EmptyState title="No webhook subscriptions" hint="Subscribe your CRM, Zapier, or an internal worker to any event pattern." />
        ) : (
          <TWrap>
            <thead><tr><Th>Label / URL</Th><Th>Matches</Th><Th>Scope</Th><Th>Fails</Th><Th>Status</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <Td><p className="font-medium">{s.label}</p><p className="font-mono text-xs text-zinc-400">{s.url}</p></Td>
                  <Td><code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">{s.eventMatch}</code></Td>
                  <Td className="text-zinc-500">{s.orgScoped ? "workspace" : "platform"}</Td>
                  <Td className={s.failCount > 0 ? "text-amber-600" : "text-zinc-400"}>{s.failCount}</Td>
                  <Td><Badge className={s.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/15 text-zinc-500"}>{s.active ? "active" : "off"}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={async () => {
                          try { setDeliveries({ sub: s, rows: await api.get<Delivery[]>(`/events/subscriptions/${s.id}/deliveries`) }); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Radio className="mr-1 inline h-3 w-3" />Log
                      </button>
                      <button
                        disabled={!s.lastError && s.active}
                        onClick={async () => {
                          try { await api.del(`/events/subscriptions/${s.id}`, { active: s.active }); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {s.active ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>

      <Card>
        <CardHeader title="Event stream" description="Recent domain events (outbox, replayable 24h)" />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : events.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <code className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-600">{e.type}</code>
                  <span className="truncate text-xs text-zinc-500">{e.aggregateType} · {e.aggregateId.slice(-8)}</span>
                </span>
                <span className="shrink-0 pl-3 text-xs text-zinc-400">{fmtDateTime(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && <SubModal onClose={() => setOpen(false)} onDone={load} />}
      {deliveries && (
        <Modal open onClose={() => setDeliveries(null)} title={`Delivery log — ${deliveries.sub.label}`} wide>
          <TWrap>
            <thead><tr><Th>Event</Th><Th>Status</Th><Th>HTTP</Th><Th>Attempts</Th><Th>When</Th><Th>Error</Th></tr></thead>
            <tbody>
              {deliveries.rows.map((d) => (
                <tr key={d.id}>
                  <Td><code className="text-xs">{d.event.type}</code></Td>
                  <Td><Badge className={d.status === "SENT" ? "bg-emerald-500/15 text-emerald-600" : d.status === "PENDING" ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-600"}>{d.status.toLowerCase()}</Badge></Td>
                  <Td>{d.responseCode ?? "—"}</Td>
                  <Td>{d.attempts}</Td>
                  <Td className="text-xs text-zinc-500">{fmtDateTime(d.at)}</Td>
                  <Td className="max-w-52 truncate text-xs text-red-500">{d.error ?? ""}</Td>
                </tr>
              ))}
              {deliveries.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">Nothing delivered yet — run the events cron or wait for the next event.</td></tr>}
            </tbody>
          </TWrap>
        </Modal>
      )}
    </div>
  );
}

const PATTERNS = ["*", "campaign.*", "offer.*", "flight.*", "content.*", "invoice.paid", "payment.*", "client.created", "social.connected"];

function SubModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ label: "", eventMatch: "invoice.paid", url: "" });
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={() => (secret ? onClose() : onClose())} title={secret ? "Subscription created" : "Subscribe to events"}>
      {secret ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Store this signing secret — it is shown once. Verifiers compute <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">sha256=&quot; + HMAC(secret, timestamp + &quot;.&quot; + body)</code> and compare to <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">x-omni-signature</code>.</p>
          <code className="block break-all rounded-lg bg-zinc-950 p-3 font-mono text-xs text-emerald-300">{secret}</code>
          <div className="flex justify-end"><Button onClick={onDone}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="CRM ingestion" /></Field>
          <Field label="Event pattern"><Select value={f.eventMatch} onChange={(e) => setF({ ...f, eventMatch: e.target.value })} options={PATTERNS.map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Endpoint URL (https)"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://hooks.example.com/omni" /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button loading={busy} onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ secret: string }>("/events/subscriptions", f);
                setSecret(r.secret);
                onDone();
              } catch (e) {
                toast("error", e instanceof Error ? e.message : "Failed");
                setBusy(false);
              }
            }}>Subscribe</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
