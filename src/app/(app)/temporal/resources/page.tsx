"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus } from "lucide-react";

type Resource = { id: string; name: string; code: string; type: string; capacity: number; location: string | null; active: boolean; requiresApproval: boolean; busyNow: boolean; metadata: Record<string, unknown> };
type Conflict = { a: string; b: string };

export default function ResourcesPage() {
  const [rows, setRows] = useState<Resource[]>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; subjectType: string; subjectId: string; pattern: { name: string; dsl: string | null } | null; blackouts: Array<{ id: string; startsAt: string; endsAt: string }> }>>([]);
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<Resource | null>(null);
  const [conflictFor, setConflictFor] = useState<Resource | null>(null);
  const [conflicts, setConflicts] = useState<{ conflicts: Conflict[]; oversubscribed: string[]; capacity: number } | null>(null);

  const load = useCallback(() => {
    api.get<Resource[]>("/temporal/resources").then(setRows).catch((e) => toast("error", e.message));
    api.get<typeof profiles>("/temporal/availability").then(setProfiles).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader title="Resources" description="Rooms, equipment, vehicles, studios, machines & people — capacity-checked with conflict detection." actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New resource</Button>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="text-xs text-zinc-400">{r.code} · {r.type.toLowerCase()} · cap {r.capacity}</p>
              </div>
              <Badge className={r.busyNow ? "bg-amber-500/15 text-amber-600" : r.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/15 text-zinc-500"}>{r.busyNow ? "busy" : r.active ? "free" : "off"}</Badge>
            </div>
            {r.location && <p className="mt-1 text-xs text-zinc-400">{r.location}</p>}
            <div className="mt-2 flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setBooking(r)}>Book</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                setConflictFor(r);
                setConflicts(null);
                try { setConflicts(await api.get(`/temporal/resources/${r.id}/conflicts`)); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
              }}>Conflicts</Button>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-zinc-400">No resources yet.</p>}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">Availability profiles</h2>
      <Card>
        <TWrap>
          <thead><tr><Th>Subject</Th><Th>Pattern</Th><Th>Upcoming blackouts</Th></tr></thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td>{p.subjectType.toLowerCase()}: <b>{p.pattern ? "" : p.subjectId.slice(-6)}</b> {p.subjectType === "USER" ? "you/teammate" : ""}</Td>
                <Td><span className="font-mono text-xs text-indigo-600">{p.pattern?.dsl ?? "—"}</span></Td>
                <Td>{p.blackouts.length ? p.blackouts.map((b) => new Date(b.startsAt).toISOString().slice(0, 10)).join(", ") : "none"}</Td>
              </tr>
            ))}
            {profiles.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400">No availability profiles.</td></tr>}
          </tbody>
        </TWrap>
      </Card>

      {open && <NewResource onClose={() => setOpen(false)} onDone={load} />}
      {booking && <BookModal resource={booking} onClose={() => setBooking(null)} onDone={load} />}
      {conflictFor && (
        <Modal open onClose={() => setConflictFor(null)} title={`Conflicts · ${conflictFor.name}`}>
          {conflicts === null ? <p className="text-sm text-zinc-400">scanning 14 days…</p> : (
            <div className="text-sm">
              <p className="mb-2">Capacity {conflicts.capacity} · overlapping pairs {conflicts.conflicts.length} · oversubscribed bookings {conflicts.oversubscribed.length}</p>
              {conflicts.conflicts.length === 0 && conflicts.oversubscribed.length === 0 && <p className="text-emerald-600">Clean — no conflicts in window.</p>}
              {conflicts.conflicts.map((c, i) => <p key={i} className="font-mono text-xs text-red-500">{c.a.slice(-6)} ⟷ {c.b.slice(-6)}</p>)}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function NewResource({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", code: "", type: "ROOM", capacity: "1", location: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New resource">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} /></Field>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={["ROOM", "EQUIPMENT", "VEHICLE", "FACILITY", "STUDIO", "MACHINE", "HUMAN", "OTHER"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
        <Field label="Capacity"><Input type="number" min="1" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Location" className="col-span-2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/temporal/resources", { name: f.name, code: f.code, type: f.type, capacity: Number(f.capacity), location: f.location || null });
              toast("success", "Resource created (auto 9–6 weekday availability)");
              onDone();
              onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}

function BookModal({ resource, onClose, onDone }: { resource: Resource; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ startsAt: "", endsAt: "", quantity: "1", notes: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Book ${resource.name}`}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (UTC ISO)"><Input className="font-mono" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} placeholder={new Date(Date.now() + 86400_000).toISOString().slice(0, 16) + "Z"} /></Field>
          <Field label="Ends"><Input className="font-mono" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <Field label={`Quantity (max ${resource.capacity})`}><Input type="number" min="1" max={resource.capacity} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ status: string }>(`/temporal/resources/${resource.id}/book`, { startsAt: f.startsAt, endsAt: f.endsAt, quantity: Number(f.quantity) });
              toast("success", r.status === "HELD" ? "Held (approval required)" : "Confirmed");
              onDone();
              onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Book</Button>
        </div>
      </div>
    </Modal>
  );
}
