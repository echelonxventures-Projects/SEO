"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";

export function RecordPaymentModal({
  open,
  onClose,
  invoiceId,
  outstanding,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  outstanding: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(outstanding / 100));
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">Outstanding: <span className="font-medium text-zinc-800 dark:text-zinc-200">{fmtMoney(outstanding)}</span></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <Input type="number" step="0.01" min="0" max={outstanding / 100} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Received on">
            <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)} options={[
              { value: "UPI", label: "UPI" },
              { value: "BANK_TRANSFER", label: "Bank transfer" },
              { value: "CARD", label: "Card" },
              { value: "NETBANKING", label: "Netbanking" },
              { value: "CASH", label: "Cash" },
              { value: "CHEQUE", label: "Cheque" },
            ]} />
          </Field>
          <Field label="Reference / UTR">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/payments", {
                invoiceId,
                amount: Number(amount),
                method,
                paidAt: new Date(paidAt).toISOString(),
                reference: reference || null,
              });
              toast("success", "Payment recorded");
              onClose();
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>
            Record payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
