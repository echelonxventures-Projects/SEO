"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { toast } from "@/components/toast";
import { Plus } from "lucide-react";

type Audience = {
  id: string;
  name: string;
  kind: string;
  source: string;
  status: string;
  description: string | null;
  client: { name: string } | null;
  sourceList: { name: string } | null;
  _count: { members: number };
};

const KINDS = ["CUSTOMER_LIST", "PROSPECT_LIST", "WEBSITE_VISITORS", "SOCIAL_FOLLOWERS", "EVENT_ATTENDEES", "LOOKALIKE_SEED", "SEGMENT"];

export default function AudiencesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Audience[]>([]);
  const [clients, setClients] = useState<Array<{ value: string; label: string }>>([]);
  const [lists, setLists] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Audience[]>("/audiences")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    api.get<{ rows: Array<{ id: string; name: string }> }>("/clients?pageSize=200").then((r) => setClients(r.rows.map((c) => ({ value: c.id, label: c.name })))).catch(() => {});
    api.get<Array<{ id: string; name: string }>>("/email/lists").then((r) => setLists(r.map((l) => ({ value: l.id, label: l.name })))).catch(() => {});
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Audiences"
        description="Your target bases — CSV upload, mailing-list sync, per-member consent."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New audience</Button>}
      />
      <Card>
        <CardHeader title="Target bases" description={`${rows.length} audiences`} />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No audiences yet" hint="Upload a CSV of customers or sync a mailing list." />
        ) : (
          <TWrap>
            <thead><tr><Th>Audience</Th><Th>Kind</Th><Th>Client</Th><Th>Source</Th><Th>Members</Th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" onClick={() => router.push(`/audiences/${a.id}`)}>
                  <Td><p className="font-medium">{a.name}</p>{a.description && <p className="text-xs text-zinc-400">{a.description}</p>}</Td>
                  <Td><Badge className="bg-sky-500/10 text-sky-600">{a.kind.replace(/_/g, " ").toLowerCase()}</Badge></Td>
                  <Td className="text-zinc-500">{a.client?.name ?? "workspace"}</Td>
                  <Td className="text-zinc-500">{a.sourceList ? `list: ${a.sourceList.name}` : a.source.toLowerCase().replace(/_/g, " ")}</Td>
                  <Td className="font-semibold tabular-nums">{a._count.members.toLocaleString("en-IN")}</Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      {open && (
        <CreateModal
          clients={clients}
          lists={lists}
          onClose={() => setOpen(false)}
          onDone={(id) => {
            setOpen(false);
            load();
            router.push(`/audiences/${id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateModal({ clients, lists, onClose, onDone }: { clients: Array<{ value: string; label: string }>; lists: Array<{ value: string; label: string }>; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: "", kind: "CUSTOMER_LIST", clientId: "", sourceListId: "", description: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New audience">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Lumen past customers" /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: k.replace(/_/g, " ").toLowerCase() }))} /></Field>
        <Field label="Client" className="col-span-2"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} options={[{ value: "", label: "Workspace-owned" }, ...clients]} /></Field>
        <Field label="Sync from mailing list" className="col-span-2" hint="Optional — imports confirmed subscribers immediately"><Select value={f.sourceListId} onChange={(e) => setF({ ...f, sourceListId: e.target.value })} options={[{ value: "", label: "None" }, ...lists]} /></Field>
        <Field label="Description" className="col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const a = await api.post<{ id: string }>("/audiences", {
                name: f.name,
                kind: f.kind,
                clientId: f.clientId || null,
                sourceListId: f.sourceListId || null,
                description: f.description || null,
              });
              toast("success", "Audience created");
              onDone(a.id);
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}
