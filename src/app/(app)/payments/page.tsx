"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ResourceScreen, StatusBadge, type Column, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMoney, fmtDate } from "@/lib/format";

type Payment = {
  id: string;
  number: string;
  method: string;
  status: string;
  amountMinor: number | bigint;
  refundedMinor: number | bigint;
  paidAt: string;
  reference: string | null;
  invoice: { number: string; id: string } | null;
  client: { name: string; id: string } | null;
  currency: { symbol: string };
};

export default function PaymentsPage() {
  const { clients } = useLookups();
  const [invoices, setInvoices] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    api
      .get<{ rows: Array<{ id: string; number: string }> }>("/invoices?pageSize=200&status=SENT")
      .then((r) => setInvoices(r.rows.map((i) => ({ value: i.id, label: i.number }))))
      .catch(() => {});
  }, []);

  const columns: Column<Payment>[] = [
    { header: "Received", cell: (p) => <span className="text-zinc-500">{fmtDate(p.paidAt)}</span> },
    { header: "Receipt #", cell: (p) => <span className="font-mono text-xs text-zinc-500">{p.number}</span> },
    { header: "Client", cell: (p) => <span className="font-medium">{p.client?.name ?? "On-account"}</span> },
    { header: "Invoice", cell: (p) => <span className="text-zinc-500">{p.invoice?.number ?? "—"}</span> },
    { header: "Method", cell: (p) => <span className="text-xs uppercase text-zinc-500">{p.method.replace("_", " ")}</span> },
    { header: "Amount", cell: (p) => <span className="font-medium text-emerald-600">{fmtMoney(Number(p.amountMinor), p.currency.symbol)}</span> },
    { header: "Status", cell: (p) => <StatusBadge value={p.refundedMinor ? "PARTIALLY_REFUNDED" : p.status} /> },
  ];
  const fields: FieldDef[] = [
    { name: "invoiceId", label: "Apply to invoice", kind: "select", options: [{ value: "", label: "On-account (advance)" }, ...invoices], half: true },
    { name: "clientId", label: "Client", kind: "select", options: [{ value: "", label: "—" }, ...clients], half: true, hint: "Required for advance payments" },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "paidAt", label: "Received on", kind: "date", required: true, half: true },
    { name: "method", label: "Method", kind: "select", required: true, half: true, default: "UPI", options: [
      { value: "UPI", label: "UPI" },
      { value: "BANK_TRANSFER", label: "Bank transfer" },
      { value: "CARD", label: "Card" },
      { value: "NETBANKING", label: "Netbanking" },
      { value: "WALLET", label: "Wallet" },
      { value: "CASH", label: "Cash" },
      { value: "CHEQUE", label: "Cheque" },
    ] },
    { name: "reference", label: "Reference / UTR", half: true },
    { name: "note", label: "Note", kind: "textarea" },
  ];
  return (
    <ResourceScreen<Payment>
      basePath="/payments"
      title="Payments"
      description="Money received against invoices and on-account."
      columns={columns}
      fields={fields}
      canEdit={false}
      toInitial={() => ({})}
      emptyTitle="No payments recorded yet"
    />
  );
}
