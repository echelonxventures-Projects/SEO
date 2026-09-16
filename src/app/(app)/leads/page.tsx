"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, PageHeader, Select, TWrap, Th, Td, EmptyState } from "@/components/ui";
import { CrudFormModal, StatusBadge, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";

type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  budgetMinor: number | bigint | null;
  stage: { id: string; name: string; isTerminalWon: boolean; isTerminalLost: boolean };
  source: { name: string } | null;
  currency: { symbol: string };
  createdAt: string;
};

export default function LeadsPage() {
  const { stages } = useLookups();
  const [sourceOpts, setSourceOpts] = useState<Array<{ value: string; label: string }>>([]);
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStage, setFilterStage] = useState("");
  const [convert, setConvert] = useState<Lead | null>(null);

  useEffect(() => {
    api.get<Array<{ id: string; name: string }>>("/settings/categories?kind=LEAD_SOURCE")
      .then((r) => setSourceOpts(r.map((s) => ({ value: s.id, label: s.name }))));
  }, []);

  const load = () => {
    setLoading(true);
    api.get<{ rows: Lead[] }>("/leads?pageSize=200")
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const shown = filterStage ? rows.filter((r) => r.stage.id === filterStage) : rows;


  async function move(lead: Lead, stageId: string) {
    try {
      await api.post(`/leads/${lead.id}/move`, { stageId });
      toast("success", "Stage updated");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  const wonStage = stages[0] && rows.find((r) => r.stage.isTerminalWon)?.stage;
  void wonStage;

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Pipeline of prospects — move, win or lose, convert to clients."
        actions={
          <NewLeadButton onDone={load} sourceOpts={sourceOpts} />
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Select
          className="w-48"
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          options={[{ value: "", label: "All stages" }, ...stages.map((s) => ({ value: s.value, label: s.label }))]}
        />
      </div>
      {loading ? (
        <Card>
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}
          </div>
        </Card>
      ) : shown.length === 0 ? (
        <Card><EmptyState title="No leads in this view" hint="Add a prospect to start your pipeline." /></Card>
      ) : (
        <Card>
          <TWrap>
            <thead>
              <tr>
                <Th>Lead</Th>
                <Th>Source</Th>
                <Th>Budget</Th>
                <Th>Stage</Th>
                <Th>Added</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-zinc-400">{[l.company, l.email].filter(Boolean).join(" · ")}</p>
                  </Td>
                  <Td><span className="text-zinc-500">{l.source?.name ?? "—"}</span></Td>
                  <Td>{l.budgetMinor != null ? fmtMoney(Number(l.budgetMinor), l.currency.symbol) : "—"}</Td>
                  <Td><StatusBadge value={l.stage.name} /></Td>
                  <Td><span className="text-xs text-zinc-400">{new Date(l.createdAt).toLocaleDateString("en-IN")}</span></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!l.stage.isTerminalWon && !l.stage.isTerminalLost && (
                        <button
                          onClick={() => {
                            const next = stages.slice();
                            const cur = next.findIndex((s) => s.value === l.stage.id);
                            if (cur >= 0 && cur < next.length - 1) move(l, next[cur + 1].value);
                          }}
                          className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          Advance →
                        </button>
                      )}
                      {!l.stage.isTerminalWon && (
                        <button
                          onClick={() => setConvert(l)}
                          className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                        >
                          Convert
                        </button>
                      )}
                      {!l.stage.isTerminalLost && !l.stage.isTerminalWon && (
                        <button
                          onClick={async () => {
                            const lost = stages[stages.length - 1];
                            if (!lost) return;
                            try {
                              await api.del(`/leads/${l.id}`, { reason: "Closed lost" });
                              toast("success", "Marked lost");
                              load();
                            } catch (e) {
                              toast("error", e instanceof Error ? e.message : "Failed");
                            }
                          }}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          Lost
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        </Card>
      )}
      {convert && (
        <ConvertModal
          lead={convert}
          onClose={() => setConvert(null)}
          onDone={() => {
            setConvert(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewLeadButton({ onDone, sourceOpts }: { onDone: () => void; sourceOpts: Array<{ value: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const fields: FieldDef[] = [
    { name: "name", label: "Contact name", required: true, half: true },
    { name: "company", label: "Company", half: true },
    { name: "email", label: "Email", kind: "email", half: true },
    { name: "phone", label: "Phone", kind: "tel", half: true },
    { name: "sourceId", label: "Source", kind: "select", options: sourceOpts, half: true },
    { name: "budget", label: "Est. budget", kind: "money", half: true },
    { name: "website", label: "Website", placeholder: "https://…", half: true },
    { name: "message", label: "Enquiry", kind: "textarea" },
  ];
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>New lead</Button>
      <CrudFormModal
        open={open}
        onClose={() => setOpen(false)}
        title="New lead"
        fields={fields}
        onSubmit={async (payload) => {
          await api.post("/leads", payload);
          setOpen(false);
          onDone();
        }}
      />
    </>
  );
}

function ConvertModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(lead.company || lead.name);
  const [email, setEmail] = useState(lead.email ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="fixed bottom-4 right-4 z-50 w-80 p-4 shadow-xl">
      <p className="text-sm font-semibold">Convert to client</p>
      <p className="mb-3 text-xs text-zinc-500">Creates a client + primary contact from “{lead.name}”.</p>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client name" className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Billing email" className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/leads/${lead.id}/convert`, { clientName: name, billingEmail: email || undefined });
              toast("success", "Lead converted to client");
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Convert</Button>
        </div>
      </div>
    </Card>
  );
}
