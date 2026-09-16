"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { toast } from "@/components/toast";
import { ArrowLeft, Upload, RefreshCw, Fingerprint, Layers } from "lucide-react";

type Audience = { id: string; name: string; kind: string; status: string; description: string | null; source: string; sourceListId: string | null; clientId: string | null; client: { name: string } | null };
type Detail = { audience: Audience; consentBreakdown: Record<string, number>; total: number };
type Member = { id: string; email: string | null; name: string | null; company: string | null; tags: string[]; consent: string; createdAt: string; identities?: Array<{ id: string; type: string; display: string | null }> };
type Seg = { id: string; name: string; description: string | null; predicate: Record<string, unknown>; size?: number };

export default function AudienceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [identityFor, setIdentityFor] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, m] = await Promise.all([
        api.get<Detail>(`/audiences/${id}`),
        api.get<Member[]>(`/audiences/${id}/members${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      ]);
      setDetail(d);
      setMembers(m);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [id, q]);
  useEffect(() => { void load(); }, [load]);

  async function doSync() {
    try {
      const r = await api.post<{ synced: number }>(`/audiences/${id}/sync`);
      toast("success", `Synced ${r.synced} subscribers from the list`);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Sync failed");
    }
  }

  if (loading && !detail) {
    return <Card><div className="p-6 text-sm text-zinc-400">Loading…</div></Card>;
  }
  if (!detail) {
    return <Card><div className="p-6 text-sm text-red-600">Audience not found.</div></Card>;
  }
  const a = detail.audience;

  return (
    <div>
      <Link href="/audiences" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline"><ArrowLeft className="h-3 w-3" /> All audiences</Link>
      <PageHeader
        title={a.name}
        description={`${a.kind.replace(/_/g, " ").toLowerCase()}${a.client ? ` · ${a.client.name}` : " · workspace"} · ${detail.total.toLocaleString("en-IN")} members`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>Add member</Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-3.5 w-3.5" /> Import CSV</Button>
            {a.sourceListId && (
              <Button size="sm" variant="outline" onClick={doSync}><RefreshCw className="h-3.5 w-3.5" /> Sync list</Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge className="bg-emerald-500/10 text-emerald-600">opt-in {detail.consentBreakdown.OPT_IN ?? 0}</Badge>
        <Badge className="bg-zinc-500/10 text-zinc-500">imported {detail.consentBreakdown.IMPORTED_LEGACY ?? 0}</Badge>
        <Badge className="bg-red-500/10 text-red-600">expired {detail.consentBreakdown.EXPIRED ?? 0}</Badge>
        <StatusBadge value={a.status} />
      </div>

      <Card>
        <div className="p-3 pb-0">
          <Input placeholder="Filter by email, name, company…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        </div>
        <div className="mt-2">
          {members.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-400">No members{q ? " match the filter" : " — add or import."}</div>
          ) : (
            <TWrap>
              <thead><tr><Th>Email / phone</Th><Th>Name</Th><Th>Company</Th><Th>Tags</Th><Th>Consent</Th><Th className="text-right"></Th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <Td><span className="font-medium">{m.email ?? m.id}</span></Td>
                    <Td className="text-zinc-500">{m.name ?? "—"}</Td>
                    <Td className="text-zinc-500">{m.company ?? "—"}</Td>
                    <Td><span className="flex flex-wrap gap-1">{m.tags.map((tg) => <span key={tg} className="rounded bg-zinc-100 px-1.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{tg}</span>)}</span></Td>
                    <Td><StatusBadge value={m.consent === "OPT_IN" ? "ACTIVE" : m.consent === "EXPIRED" ? "EXPIRED" : "DRAFT"} /></Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setIdentityFor(m.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Fingerprint className="mr-1 inline h-3 w-3" />IDs {(m.identities?.length ?? 0) + 1}
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm("Remove this member?")) return;
                          try { await api.del(`/audiences/${id}/members/${m.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                        }}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        Remove
                      </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TWrap>
          )}
        </div>
      </Card>

      {identityFor && <IdentityModal memberId={identityFor} onClose={() => { setIdentityFor(null); load(); }} />}
      <SegmentsCard audienceId={id} />
      {addOpen && <AddMemberModal audienceId={id} onClose={() => setAddOpen(false)} onDone={load} />}
      {importOpen && (
        <ImportModal
          fileRef={fileRef}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); }}
          onFile={async (csv) => {
            const r = await fetch(`/api/v1/audiences/${id}/import`, { method: "POST", headers: { origin: window.location.origin, "x-csrf-token": (document.cookie.match(/omnimark_csrf=([^;]+)/)?.[1] ?? "") }, body: csv });
            const json = await r.json();
            if (!r.ok) throw new Error(json?.error?.message ?? "Import failed");
            toast("success", `Imported ${json.data.created} new, updated ${json.data.updated}${json.data.errors.length ? ` (${json.data.errors.length} skipped)` : ""}`);
            setImportOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddMemberModal({ audienceId, onClose, onDone }: { audienceId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ email: "", phone: "", name: "", company: "", tags: "", consent: "IMPORTED_LEGACY" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add member">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Company"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        <Field label="Tags (comma)"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        <Field label="Consent"><Select value={f.consent} onChange={(e) => setF({ ...f, consent: e.target.value })} options={[
          { value: "IMPORTED_LEGACY", label: "Imported (legacy)" },
          { value: "OPT_IN", label: "Opted in" },
          { value: "EXPIRED", label: "Expired" },
        ]} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/audiences/${audienceId}/members`, {
                email: f.email || null, phone: f.phone || null, name: f.name || null, company: f.company || null,
                tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), consent: f.consent,
              });
              toast("success", "Member added");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone, onFile, fileRef }: { onClose: () => void; onDone: () => void; onFile: (csv: string) => Promise<void>; fileRef: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState("email,name,company,tags,consent\njane@acme.test,Jane Doe,Acme,vip|inbound,opt_in");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Import members from CSV" wide>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Columns: <code>email</code>, <code>phone</code>, <code>id</code> (one identity), <code>name</code>, <code>company</code>, <code>tags</code> (pipe-separated), <code>consent</code> (opt_in|expired).
          Re-importing the same person updates instead of duplicating.
        </p>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setText(await file.text());
          }} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Choose .csv file</Button>
          <span className="text-xs text-zinc-400">or paste below</span>
        </div>
        <Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!text.trim()) { toast("error", "Paste or choose a CSV first"); return; }
            setBusy(true);
            try {
              await onFile(text);
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Import failed");
            } finally {
              setBusy(false);
            }
          }}>Import</Button>
        </div>
      </div>
    </Modal>
  );
}

export function SegmentsCard({ audienceId }: { audienceId: string }) {
  const [segs, setSegs] = useState<Seg[]>([]);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", consent: "", tagIncludes: "", hasIdentityType: "", q: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ seg: string; count: number; sample: string[] } | null>(null);
  useEffect(() => {
    api.get<Seg[]>(`/audiences/${audienceId}/segments`).then(setSegs).catch(() => {});
  }, [audienceId]);
  return (
    <Card className="mt-4">
      <CardHeader
        title={<span><Layers className="mr-1.5 inline h-4 w-4 text-zinc-400" />Rule segments</span>}
        description="Dynamic predicates re-evaluated live — members matching now, not frozen lists"
        actions={<Button size="sm" variant="outline" onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New segment"}</Button>}
      />
      {creating && (
        <div className="grid gap-2 border-b border-zinc-100 p-4 sm:grid-cols-5 dark:border-zinc-800">
          <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select value={f.consent} onChange={(e) => setF({ ...f, consent: e.target.value })} options={[{ value: "", label: "any consent" }, { value: "OPT_IN", label: "opt-in" }, { value: "IMPORTED_LEGACY", label: "imported" }, { value: "EXPIRED", label: "expired" }]} />
          <Input placeholder="tags (comma)" value={f.tagIncludes} onChange={(e) => setF({ ...f, tagIncludes: e.target.value })} />
          <Input placeholder="identity type (email/device…)" value={f.hasIdentityType} onChange={(e) => setF({ ...f, hasIdentityType: e.target.value })} />
          <Button size="sm" loading={busy} onClick={async () => {
            if (!f.name.trim()) return;
            setBusy(true);
            const predicate: Record<string, unknown> = {};
            if (f.consent) predicate.consent = f.consent;
            if (f.tagIncludes.trim()) predicate.tagIncludes = f.tagIncludes.split(",").map((x) => x.trim()).filter(Boolean);
            if (f.hasIdentityType.trim()) predicate.hasIdentityType = f.hasIdentityType.trim().toLowerCase();
            if (f.q.trim()) predicate.q = f.q.trim();
            try {
              await api.post(`/audiences/${audienceId}/segments`, { name: f.name.trim(), predicate });
              setCreating(false); setF({ name: "", consent: "", tagIncludes: "", hasIdentityType: "", q: "" });
              setSegs(await api.get<Seg[]>(`/audiences/${audienceId}/segments`));
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            setBusy(false);
          }}>Create</Button>
        </div>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {segs.length === 0 && <li className="px-4 py-4 text-sm text-zinc-400">No segments — add consent or tag rules.</li>}
        {segs.map((sg) => (
          <li key={sg.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium">{sg.name} <span className="ml-1 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{sg.size ?? "…"} match</span></p>
              <p className="font-mono text-[11px] text-zinc-400">{JSON.stringify(sg.predicate)}</p>
            </div>
            <div className="flex gap-1.5">
              <button className="rounded px-2 py-1 text-xs text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950" onClick={async () => {
                const r = await api.get<{ count: number; members: Array<{ email: string | null }> }>(`/segments/${sg.id}/members`);
                setResult({ seg: sg.name, count: r.count, sample: r.members.slice(0, 6).map((m) => m.email ?? "id").filter(Boolean) });
              }}>Evaluate</button>
              <button className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={async () => { await api.del(`/segments/${sg.id}`); setSegs(await api.get<Seg[]>(`/audiences/${audienceId}/segments`)); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {result && (
        <div className="border-t border-zinc-100 p-3 text-xs dark:border-zinc-800">
          <b>{result.seg}</b>: {result.count} match{result.count === 1 ? "" : "es"} — sample: {result.sample.join(", ")}
        </div>
      )}
    </Card>
  );
}

export function IdentityModal({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const [ids, setIds] = useState<Array<{ id: string; type: string; display: string | null }>>([]);
  const [f, setF] = useState({ type: "device", value: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<typeof ids>(`/members/${memberId}/identities`).then(setIds).catch(() => {});
  }, [memberId]);
  return (
    <Modal open onClose={onClose} title="Member identities">
      <div className="space-y-3">
        <ul className="space-y-1">
          {ids.map((i) => (
            <li key={i.id} className="flex items-center justify-between rounded bg-zinc-50 px-2.5 py-1.5 text-sm dark:bg-zinc-800/40">
              <span><Fingerprint className="mr-1.5 inline h-3.5 w-3.5 text-zinc-400" />{i.type}: {i.display ?? "••••"}</span>
              <button className="text-xs text-red-600 hover:underline" onClick={async () => { await api.del(`/identities/${i.id}`); setIds(await api.get<typeof ids>(`/members/${memberId}/identities`)); }}>remove</button>
            </li>
          ))}
          {ids.length === 0 && <li className="text-sm text-zinc-400">Only the primary identity exists.</li>}
        </ul>
        <div className="flex gap-2">
          <Select className="w-36" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={["email", "phone", "device", "cookie", "crm", "external", "social"].map((x) => ({ value: x, label: x }))} />
          <Input placeholder="value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <Button size="sm" loading={busy} onClick={async () => {
            if (f.value.length < 2) return;
            setBusy(true);
            try {
              await api.post(`/members/${memberId}/identities`, { type: f.type, value: f.value, display: f.value.slice(0, 24) });
              setIds(await api.get<typeof ids>(`/members/${memberId}/identities`));
              setF({ ...f, value: "" });
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            setBusy(false);
          }}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}
