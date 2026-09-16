"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useLookups } from "@/components/lookups";
import { fmtMoney } from "@/lib/format";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/components/toast";

type Line = {
  description: string;
  qty: number;
  unitPrice: number;
  discountBps: number;
  taxRateId: string | null;
};

type TaxRateLite = { id: string; name: string; code: string; rateBps: number; kind: string };

export function DocumentBuilder({
  open,
  onClose,
  kind,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  kind: "QUOTE" | "INVOICE";
  onCreated: (id: string) => void;
}) {
  const { clients } = useLookups();
  const [rates, setRates] = useState<TaxRateLite[]>([]);
  const [clientId, setClientId] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { description: "", qty: 1, unitPrice: 0, discountBps: 0, taxRateId: null },
  ]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [dateField, setDateField] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      api
        .get<TaxRateLite[]>("/settings/tax-rates")
        .then((r) => setRates(r.filter((t) => !/-(CGST|SGST|IGST)$/.test(t.code))))
        .catch(() => setRates([]));
    }
  }, [open]);

  const bpsOf = (id: string | null) => rates.find((r) => r.id === id)?.rateBps ?? 0;

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const gross = Math.round(l.unitPrice * 100) * Math.max(0, Math.round(l.qty * 100)) / 100;
      const disc = Math.round((gross * l.discountBps) / 10000);
      const net = Math.round(gross) - disc;
      subtotal += net;
      tax += Math.round((net * bpsOf(l.taxRateId)) / 10000);
    }
    const discMinor = Math.round(Number(discount || 0) * 100);
    const total = Math.max(0, subtotal + tax - discMinor);
    return { subtotal, tax, discMinor, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, discount, rates]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    if (!clientId) {
      toast("error", "Choose a client");
      return;
    }
    if (lines.length === 0 || lines.some((l) => !l.description.trim() || l.qty <= 0)) {
      toast("error", "Every line needs a description and quantity");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        clientId,
        discount: Number(discount || 0),
        notes: notes || null,
        terms: terms || null,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountBps: l.discountBps,
          taxRateId: l.taxRateId,
        })),
      };
      if (dateField) payload[kind === "QUOTE" ? "validUntil" : "dueDate"] = dateField;
      const res = await api.post<{ id: string }>(kind === "QUOTE" ? "/quotes" : "/invoices", payload);
      toast("success", kind === "QUOTE" ? "Quote created" : "Invoice created");
      onCreated(res.id);
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`New ${kind === "QUOTE" ? "quote" : "invoice"}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} options={[{ value: "", label: "Select client…" }, ...clients]} />
          </Field>
          <Field label={kind === "QUOTE" ? "Valid until" : "Due date"}>
            <Input type="date" value={dateField} onChange={(e) => setDateField(e.target.value)} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-zinc-500">Line items</p>
          <div className="space-y-2">
            {lines.map((l, i) => {
              const gross = Math.round(l.unitPrice * 100) * Math.round(l.qty * 100) / 10000;
              const net = Math.round(gross * (1 - l.discountBps / 10000) * 100);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-4">
                    <Input placeholder="Description" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.01" min="0" placeholder="Qty" value={l.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.01" min="0" placeholder="Unit ₹" value={l.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2">
                    <Select
                      value={l.taxRateId ?? ""}
                      onChange={(e) => update(i, { taxRateId: e.target.value || null })}
                      options={[{ value: "", label: "No tax" }, ...rates.map((r) => ({ value: r.id, label: r.name }))]}
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    <span className="text-xs tabular-nums text-zinc-500">{fmtMoney(net)}</span>
                    <button
                      aria-label="Remove line"
                      disabled={lines.length === 1}
                      onClick={() => setLines((cur) => cur.filter((_, idx) => idx !== i))}
                      className="text-zinc-400 hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => setLines((cur) => [...cur, { description: "", qty: 1, unitPrice: 0, discountBps: 0, taxRateId: null }])}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-300"
          >
            <Plus className="h-3 w-3" /> Add line
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Document discount" hint="Applied after line tax">
            <Input type="number" step="0.01" min="0" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <Field label="Terms">
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, scope, validity…" />
        </Field>

        <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="text-sm">
            <p className="text-zinc-500">Subtotal {fmtMoney(totals.subtotal)}</p>
            <p className="text-zinc-500">Tax {fmtMoney(totals.tax)}</p>
            {totals.discMinor > 0 && <p className="text-zinc-500">Discount −{fmtMoney(totals.discMinor)}</p>}
            <p className="mt-1 text-lg font-semibold">{fmtMoney(totals.total)} total</p>
          </div>
          <Button loading={busy} onClick={submit}>
            Create {kind === "QUOTE" ? "quote" : "invoice"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
