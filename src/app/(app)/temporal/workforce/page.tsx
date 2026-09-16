"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, RefreshCw } from "lucide-react";

type Shift = { id: string; name: string; code: string; kind: string; startTime: string; endTime: string; crossDay: boolean; color: string; requiredSkills: string[]; _count: { assignments: number } };
type Gap = { day: string; window: string; required: number; have: number; skill: string | null };
type Member = { id: string; name: string };

export default function WorkforcePage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [open, setOpen] = useState(false);
  const [rot, setRot] = useState(false);
  const [assignFor, setAssignFor] = useState<Shift | null>(null);
  const [covOpen, setCovOpen] = useState(false);

  const load = useCallback(() => {
    api.get<Shift[]>("/temporal/workforce/shifts").then(setShifts).catch((e) => toast("error", e.message));
    api.get<{ gaps: Gap[] }>("/temporal/workforce/coverage").then((r) => setGaps(r.gaps)).catch(() => undefined);
    api.get<{ members: Array<{ id: string; userId?: string; name: string }> }>("/team/members").then((r) => setMembers((r.members ?? []).map((x) => ({ id: x.userId ?? x.id, name: x.name })))).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader title="Workforce scheduling" description="Shifts, rotations, coverage requirements and gap analysis — driven by temporal assets." actions={<>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button size="sm" variant="outline" onClick={() => setRot(true)}>Generate rotation</Button>
        <Button size="sm" variant="outline" onClick={() => setCovOpen(true)}>Coverage rule</Button>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New shift</Button>
      </>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shifts.map((sh) => (
          <Card key={sh.id} className="p-4">
            <div className="mb-2 h-1 w-8 rounded-full" style={{ background: sh.color }} />
            <div className="flex items-center justify-between">
              <p className="font-semibold">{sh.name}</p>
              <Badge className="bg-zinc-500/10 text-zinc-500">{sh.kind.toLowerCase()}</Badge>
            </div>
            <p className="mt-1 font-mono text-sm tabular-nums">{sh.startTime}–{sh.endTime}{sh.crossDay ? " (+1)" : ""}</p>
            <p className="mt-1 text-xs text-zinc-400">{sh._count.assignments} assignments · {sh.requiredSkills.join(", ") || "any skill"}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setAssignFor(sh)}>Assign</Button>
          </Card>
        ))}
        {shifts.length === 0 && <p className="text-sm text-zinc-400">No shifts yet — create or instantiate the “3-shift rotation” library template.</p>}
      </div>

      <CardHeader title="Coverage gaps (next 7 days)" description="Requirements vs assignments — red means understaffed windows" />
      <Card>
        <TWrap>
          <thead><tr><Th>Day</Th><Th>Window</Th><Th>Have / Required</Th><Th>Skill</Th></tr></thead>
          <tbody>
            {gaps.map((g, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td className="tabular-nums">{g.day}</Td>
                <Td className="font-mono text-xs">{g.window}</Td>
                <Td><Badge className="bg-red-500/10 text-red-500">{g.have}/{g.required}</Badge></Td>
                <Td>{g.skill ?? "any"}</Td>
              </tr>
            ))}
            {gaps.length === 0 && <tr><td className="px-3 py-6 text-sm text-emerald-600">Fully covered for the next week 🎯</td></tr>}
          </tbody>
        </TWrap>
      </Card>

      {open && <NewShift onClose={() => setOpen(false)} onDone={load} />}
      {assignFor && <AssignModal shift={assignFor} members={members} onClose={() => setAssignFor(null)} onDone={load} />}
      {rot && <RotationModal shifts={shifts} members={members} onClose={() => setRot(false)} onDone={load} />}
      {covOpen && <CoverageModal onClose={() => setCovOpen(false)} onDone={load} />}
    </div>
  );
}

function NewShift({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", code: "", startTime: "09:00", endTime: "17:00", kind: "FIXED" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New shift">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Start (HH:MM)"><Input value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="End (HH:MM)"><Input value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={["FIXED", "ROTATING", "ON_CALL", "SPLIT", "FLEXIBLE"].map((v) => ({ value: v, label: v.toLowerCase() }))} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try { await api.post("/temporal/workforce/shifts", f); toast("success", "Shift created"); onDone(); onClose(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}

function AssignModal({ shift, members, onClose, onDone }: { shift: Shift; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ userId: members[0]?.id ?? "", day: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Assign ${shift.name}`}>
      <div className="grid gap-3">
        <Field label="Member"><Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} options={members.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Date"><Input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          const startsAt = `${f.day}T${shift.startTime}:00.000Z`;
          const [eh, em] = shift.endTime.split(":").map(Number);
          const [sh, sm] = shift.startTime.split(":").map(Number);
          let minutes = (eh * 60 + em) - (sh * 60 + sm);
          if (minutes <= 0 || shift.crossDay) minutes += 24 * 60;
          const endsAt = new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();
          try { await api.post("/temporal/workforce/assign", { shiftId: shift.id, userId: f.userId, startsAt, endsAt }); toast("success", "Assigned"); onDone(); onClose(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
        }}>Assign shift</Button>
      </div>
    </Modal>
  );
}

function RotationModal({ shifts, members, onClose, onDone }: { shifts: Shift[]; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedUsers, setPickedUsers] = useState<string[]>([]);
  const [days, setDays] = useState("21");
  const [cycle, setCycle] = useState("3");
  const [busy, setBusy] = useState(false);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <Modal open onClose={onClose} title="Generate rotation">
      <div className="grid gap-3">
        <p className="text-xs font-semibold uppercase text-zinc-400">Shifts in rotation (order matters)</p>
        <div className="flex flex-wrap gap-1">
          {shifts.map((s) => <button key={s.id} onClick={() => toggle(picked, s.id, setPicked)} className={`rounded px-2 py-1 text-xs ${picked.includes(s.id) ? "bg-indigo-500 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{s.name}</button>)}
        </div>
        <p className="text-xs font-semibold uppercase text-zinc-400">People</p>
        <div className="flex flex-wrap gap-1">
          {members.map((m) => <button key={m.id} onClick={() => toggle(pickedUsers, m.id, setPickedUsers)} className={`rounded px-2 py-1 text-xs ${pickedUsers.includes(m.id) ? "bg-indigo-500 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{m.name}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Days to generate"><Input type="number" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <Field label="Cycle length (days/shift)"><Input type="number" value={cycle} onChange={(e) => setCycle(e.target.value)} /></Field>
        </div>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await api.post<{ created: number; skipped: number }>("/temporal/workforce/rotate", { shiftIds: picked, userIds: pickedUsers, startsAt: new Date().toISOString(), days: Number(days), cycleLengthDays: Number(cycle) });
            toast("success", `${r.created} assignments (${r.skipped} skipped — overlaps)`);
            onDone();
            onClose();
          } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
        }}>Generate</Button>
      </div>
    </Modal>
  );
}

function CoverageModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ dayOfWeek: "1", startTime: "09:00", endTime: "18:00", requiredCount: "2", skill: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Coverage requirement">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day of week"><Select value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: e.target.value })} options={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((v, i) => ({ value: String(i), label: v }))} /></Field>
        <Field label="Required headcount"><Input type="number" value={f.requiredCount} onChange={(e) => setF({ ...f, requiredCount: e.target.value })} /></Field>
        <Field label="Start"><Input value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="End"><Input value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <Field label="Skill (optional)" className="col-span-2"><Input value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end">
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try { await api.post("/temporal/workforce/coverage", { dayOfWeek: Number(f.dayOfWeek), startTime: f.startTime, endTime: f.endTime, requiredCount: Number(f.requiredCount), skill: f.skill || null }); toast("success", "Saved"); onDone(); onClose(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Save rule</Button>
        </div>
      </div>
    </Modal>
  );
}
