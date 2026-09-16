"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus, RefreshCw } from "lucide-react";

type Appt = { id: string; referenceCode: string; attendeeName: string; attendeeEmail: string | null; service: string | null; status: string; startsAt: string; endsAt: string; waitlistPos: number | null; calendar: { name: string; color: string } };
type Slot = { id: string; startsAt: string; endsAt: string; capacity: number; booked: number; remaining: number; status: string };

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "bg-emerald-500/15 text-emerald-600",
  PENDING: "bg-amber-500/15 text-amber-600",
  WAITLISTED: "bg-violet-500/15 text-violet-600",
  CHECKED_IN: "bg-sky-500/15 text-sky-600",
  COMPLETED: "bg-zinc-500/15 text-zinc-500",
  CANCELLED: "bg-red-500/10 text-red-500",
  NO_SHOW: "bg-red-500/10 text-red-500",
};

export default function AppointmentsPage() {
  const [rows, setRows] = useState<Appt[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([]);
  const [calId, setCalId] = useState("");
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [booking, setBooking] = useState<Slot | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Appt[]>("/temporal/appointments").then(setRows).catch((e) => toast("error", e.message)).finally(() => setLoading(false));
    if (calId) api.get<Slot[]>(`/temporal/slots/open?calendarId=${calId}`).then(setSlots).catch(() => setSlots([]));
  }, [calId]);
  useEffect(() => { api.get<Array<{ id: string; name: string }>>("/temporal/calendars").then((cs) => { setCalendars(cs); if (!calId && cs[0]) setCalId(cs[0].id); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  const act = async (id: string, action: string, extra?: object) => {
    try {
      await api.post(`/temporal/appointments/${id}/${action}`, { action, ...extra });
      toast("success", "Done");
      load();
    } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div>
      <PageHeader title="Appointments" description="Slots generated from temporal assets; capacity-atomic booking; waitlist auto-promotion on release." actions={<>
        <Button size="sm" variant="outline" onClick={async () => {
          if (!calId) { toast("error", "Pick a calendar first"); return; }
          try {
            const r = await api.get<{ path: string; openSlots: number }>(`/temporal/calendars/${calId}/booking-link`);
            const url = `${window.location.origin}${r.path}`;
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            toast("success", `Public booking link copied (${r.openSlots} open slots, valid 30 days)`);
            window.open(r.path, "_blank");
          } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
        }}>Public booking link</Button>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button size="sm" onClick={() => setGenOpen(true)}><Plus className="h-3.5 w-3.5" /> Generate slots</Button>
      </>} />

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <div>
          <CardHeader title={`Open slots · ${calendars.find((c) => c.id === calId)?.name ?? ""}`} />
          <Card>
            <div className="border-b px-3 py-2"><Select value={calId} onChange={(e) => setCalId(e.target.value)} options={calendars.map((c) => ({ value: c.id, label: c.name }))} /></div>
            <TWrap>
              <thead><tr><Th>Starts</Th><Th>Capacity</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <Td className="tabular-nums">{new Date(s.startsAt).toUTCString().slice(5, 22)}</Td>
                    <Td>{s.capacity - s.booked}/{s.capacity} free</Td>
                    <Td><Badge className={STATUS_COLORS.OPEN ?? ""}>{s.status.toLowerCase()}</Badge></Td>
                    <Td className="text-right"><Button size="sm" onClick={() => setBooking(s)}>Book</Button></Td>
                  </tr>
                ))}
                {slots.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400">No open slots for this calendar — generate some.</td></tr>}
              </tbody>
            </TWrap>
          </Card>
        </div>
        <div>
          <CardHeader title="Appointments" description={`${rows.length} records`} />
          <Card>
            <TWrap>
              <thead><tr><Th>Ref</Th><Th>Attendee</Th><Th>When</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <Td><span className="font-mono text-xs">{a.referenceCode}</span></Td>
                    <Td><span className="font-medium">{a.attendeeName}</span>{a.service ? <span className="text-xs text-zinc-400"> · {a.service}</span> : null}{a.waitlistPos != null ? <span className="text-[10px] text-violet-500"> pos {a.waitlistPos}</span> : null}</Td>
                    <Td className="tabular-nums text-xs">{new Date(a.startsAt).toUTCString().slice(5, 22)}</Td>
                    <Td><Badge className={STATUS_COLORS[a.status] ?? ""}>{a.status.toLowerCase()}</Badge></Td>
                    <Td className="text-right whitespace-nowrap">
                      {a.status === "PENDING" && <button className="text-xs text-emerald-600 hover:underline" onClick={() => act(a.id, "confirm")}>confirm</button>}
                      {a.status === "WAITLISTED" && <button className="text-xs text-emerald-600 hover:underline" onClick={() => act(a.id, "confirm")}>promote</button>}
                      {["PENDING", "CONFIRMED"].includes(a.status) && <button className="text-xs text-sky-600 hover:underline" onClick={() => act(a.id, "checkIn")}>check-in</button>}
                      {["CONFIRMED", "CHECKED_IN"].includes(a.status) && <button className="text-xs text-zinc-500 hover:underline" onClick={() => act(a.id, "complete")}>complete</button>}
                      {!["CANCELLED", "COMPLETED", "NO_SHOW"].includes(a.status) && <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => act(a.id, "cancel", { reason: "workspace" })}>cancel</button>}
                    </Td>
                  </tr>
                ))}
                {loading && rows.length === 0 && <tr><td className="px-3 py-6 text-sm text-zinc-400">loading…</td></tr>}
              </tbody>
            </TWrap>
          </Card>
        </div>
      </div>

      {genOpen && <GenerateModal calendars={calendars} onClose={() => setGenOpen(false)} onDone={load} />}
      {booking && <BookModal slot={booking} onClose={() => setBooking(null)} onDone={() => { setBooking(null); load(); }} />}
    </div>
  );
}

function GenerateModal({ calendars, onClose, onDone }: { calendars: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ calendarId: calendars[0]?.id ?? "", slotMinutes: "30", durationMinutes: "30", capacity: "1", horizonDays: "14" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Generate slots from temporal assets">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calendar" className="col-span-2"><Select value={f.calendarId} onChange={(e) => setF({ ...f, calendarId: e.target.value })} options={calendars.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Slot step (min)"><Input type="number" value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: e.target.value })} /></Field>
        <Field label="Duration (min)"><Input type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
        <Field label="Capacity / slot"><Input type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Horizon (days)"><Input type="number" value={f.horizonDays} onChange={(e) => setF({ ...f, horizonDays: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ created: number; skippedByRules: number }>("/temporal/slots/generate", { calendarId: f.calendarId, slotMinutes: Number(f.slotMinutes), durationMinutes: Number(f.durationMinutes), capacity: Number(f.capacity), horizonDays: Number(f.horizonDays) });
              toast("success", `${r.created} slots created (${r.skippedByRules} blocked by rules)`);
              onDone();
              onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Generate</Button>
        </div>
      </div>
    </Modal>
  );
}

function BookModal({ slot, onClose, onDone }: { slot: Slot; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ attendeeName: "", attendeeEmail: "", service: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Book ${new Date(slot.startsAt).toUTCString().slice(5, 22)}`}>
      <div className="grid gap-3">
        <Field label="Attendee name"><Input value={f.attendeeName} onChange={(e) => setF({ ...f, attendeeName: e.target.value })} /></Field>
        <Field label="Email (optional)"><Input value={f.attendeeEmail} onChange={(e) => setF({ ...f, attendeeEmail: e.target.value })} /></Field>
        <Field label="Service (optional)"><Input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ waitlisted: boolean }>("/temporal/appointments/book", { slotId: slot.id, attendeeName: f.attendeeName, attendeeEmail: f.attendeeEmail || null, service: f.service || null });
              toast(r.waitlisted ? "info" : "success", r.waitlisted ? "Slot just filled — added to waitlist" : "Booked");
              onDone();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Book now</Button>
        </div>
      </div>
    </Modal>
  );
}
