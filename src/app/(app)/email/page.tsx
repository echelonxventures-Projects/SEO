"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { fmtDateTime, statusClass } from "@/lib/format";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";

type List = { id: string; name: string; description: string | null; doubleOptIn: boolean; _count: { subscribers: number } };
type Campaign = {
  id: string;
  subject: string;
  status: string;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  opensCount: number;
  scheduledAt: string | null;
  createdAt: string;
  list: { name: string; id: string };
};

const TABS = ["Campaigns", "Lists"] as const;

export default function EmailPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Campaigns");
  const [lists, setLists] = useState<List[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [campOpen, setCampOpen] = useState(false);
  const [subsFor, setSubsFor] = useState<List | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, c] = await Promise.all([api.get<List[]>("/email/lists"), api.get<Campaign[]>("/email/campaigns")]);
      setLists(l);
      setCampaigns(c);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(path: string, body?: unknown) {
    try {
      await api.post(path, body ?? {});
      toast("success", "Done");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Email marketing"
        description="Double opt-in lists, one-click unsubscribe, tracked opens, batched delivery."
        actions={
          tab === "Campaigns"
            ? <Button size="sm" onClick={() => setCampOpen(true)}>New campaign</Button>
            : <Button size="sm" onClick={() => setListOpen(true)}>New list</Button>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white" : "border-transparent text-zinc-500")}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <Card><div className="p-6 text-sm text-zinc-400">Loading…</div></Card>
      ) : tab === "Campaigns" ? (
        <Card>
          <TWrap>
            <thead><tr><Th>Campaign</Th><Th>List</Th><Th>Status</Th><Th>Delivered</Th><Th>Opened</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {campaigns.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-400">No campaigns yet</td></tr>}
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <Td><p className="font-medium">{c.subject}</p><p className="text-xs text-zinc-400">{fmtDateTime(c.createdAt)}</p></Td>
                  <Td className="text-zinc-500">{c.list.name}</Td>
                  <Td><Badge className={statusClass(c.status)}>{c.status.toLowerCase()}</Badge></Td>
                  <Td className="tabular-nums">{c.sentCount}/{c.queuedCount}{c.failedCount > 0 && <span className="text-red-500"> · {c.failedCount} failed</span>}</Td>
                  <Td className="tabular-nums">{c.opensCount}{c.sentCount > 0 && <span className="text-xs text-zinc-400"> ({Math.round((c.opensCount / c.sentCount) * 100)}%)</span>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {c.status === "DRAFT" && (
                        <>
                          <button onClick={() => act(`/email/campaigns/${c.id}/test`)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Send test</button>
                          <button onClick={() => act(`/email/campaigns/${c.id}/queue`)} className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">Send now</button>
                        </>
                      )}
                      {["DRAFT", "SCHEDULED"].includes(c.status) && (
                        <button onClick={() => act(`/email/campaigns/${c.id}/cancel`)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Cancel</button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        </Card>
      ) : (
        <Card>
          {lists.length === 0 ? (
            <EmptyState title="No lists yet" hint="Create a list, then add subscribers — double opt-in keeps you compliant." />
          ) : (
            <TWrap>
              <thead><tr><Th>List</Th><Th>Opt-in mode</Th><Th>Subscribers</Th><Th className="text-right"></Th></tr></thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <Td><p className="font-medium">{l.name}</p><p className="text-xs text-zinc-400">{l.description ?? ""}</p></Td>
                    <Td><Badge className={l.doubleOptIn ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}>{l.doubleOptIn ? "double" : "single"}</Badge></Td>
                    <Td className="tabular-nums">{l._count.subscribers}</Td>
                    <Td className="text-right"><button onClick={() => setSubsFor(l)} className="rounded px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950">Manage</button></Td>
                  </tr>
                ))}
              </tbody>
            </TWrap>
          )}
        </Card>
      )}

      {listOpen && <ListModal onClose={() => setListOpen(false)} onDone={load} />}
      {campOpen && <CampaignModal lists={lists} onClose={() => setCampOpen(false)} onDone={load} />}
      {subsFor && <SubscribersModal list={subsFor} onClose={() => setSubsFor(null)} onDone={load} />}
    </div>
  );
}

function ListModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", description: "", doubleOptIn: true, welcomeSubject: "", welcomeBody: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New mailing list">
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Lumen newsletter" /></Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.doubleOptIn} onChange={(e) => setF({ ...f, doubleOptIn: e.target.checked })} className="h-4 w-4" />Double opt-in (recommended)</label>
        <Field label="Welcome subject (optional)"><Input value={f.welcomeSubject} onChange={(e) => setF({ ...f, welcomeSubject: e.target.value })} /></Field>
        <Field label="Welcome body (optional, {'{{name}}'} supported)"><Textarea rows={3} value={f.welcomeBody} onChange={(e) => setF({ ...f, welcomeBody: e.target.value })} /></Field>
        <div className="flex justify-end">
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/email/lists", { name: f.name, description: f.description || null, doubleOptIn: f.doubleOptIn, welcomeSubject: f.welcomeSubject || null, welcomeBody: f.welcomeBody || null });
              onDone(); onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Create list</Button>
        </div>
      </div>
    </Modal>
  );
}

function CampaignModal({ lists, onClose, onDone }: { lists: List[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ listId: lists[0]?.id ?? "", subject: "", preheader: "", body: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New email campaign" wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="List"><Select value={f.listId} onChange={(e) => setF({ ...f, listId: e.target.value })} options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l._count.subscribers})` }))} /></Field>
          <Field label="Preheader"><Input value={f.preheader} onChange={(e) => setF({ ...f, preheader: e.target.value })} /></Field>
        </div>
        <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Body (markdown — **bold**, # heading, [link](url), 'Hi there,' greets by name)" hint="Draft from the AI studio newsletter tab and paste it here">
          <Textarea rows={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/email/campaigns", {
                listId: f.listId,
                subject: f.subject,
                preheader: f.preheader || null,
                bodyMarkdown: f.body,
              });
              toast("success", "Campaign saved as draft");
              onDone(); onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Save draft</Button>
        </div>
      </div>
    </Modal>
  );
}

type Subscriber = { id: string; email: string; name: string | null; status: string; subscribedAt: string | null };

function SubscribersModal({ list, onClose, onDone }: { list: List; onClose: () => void; onDone: () => void }) {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Subscriber[]>(`/email/lists/${list.id}/subscribers`).then(setSubs).catch(() => {});
  }, [list.id]);
  useEffect(load, [load]);

  return (
    <Modal open onClose={onClose} title={`Subscribers — ${list.name}`} wide>
      <div className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-2">
        <Input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/email/lists/${list.id}/subscribers`, { email, name: name || null });
            setEmail(""); setName("");
            toast("success", list.doubleOptIn ? "Opt-in email sent" : "Subscriber added");
            load(); onDone();
          } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
          setBusy(false);
        }}>Add</Button>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <tbody>
            {subs.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">{s.email}</td>
                <td className="px-3 py-2 text-zinc-500">{s.name ?? ""}</td>
                <td className="px-3 py-2 text-right"><Badge className={statusClass(s.status)}>{s.status.toLowerCase()}</Badge></td>
              </tr>
            ))}
            {subs.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-zinc-400">No subscribers yet</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
