"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, EmptyState, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { ListCard, StatusBadge, Toolbar } from "@/components/crud";
import { DocumentBuilder } from "@/components/document-builder";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";

type Invoice = {
  id: string;
  number: string;
  status: string;
  totalMinor: number | bigint;
  paidMinor: number | bigint;
  currency: { symbol: string };
  issueDate: string;
  dueDate: string | null;
  client: { name: string } | null;
};

const STATUSES = ["", "DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"];

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ pageSize: "100" });
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    api
      .get<{ rows: Invoice[] }>(`/invoices?${p}`)
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, [search, status]);
  useEffect(load, [load]);

  async function act(id: string, action: string, body?: unknown) {
    try {
      const res = await api.post<{ payUrl?: string }>(`/invoices/${id}/${action}`, body ?? {});
      if (action === "checkout" && res?.payUrl) {
        navigator.clipboard?.writeText(window.location.origin + res.payUrl).catch(() => {});
        toast("success", "Payment link copied — send it to the client");
      } else {
        toast("success", "Done");
      }
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  const openable = ["SENT", "OVERDUE", "PARTIALLY_PAID"];

  return (
    <div>
      <PageHeader title="Invoices" description="GST-ready invoicing with online collection." actions={<Button size="sm" onClick={() => setOpen(true)}>New invoice</Button>} />
      <Toolbar
        search={search}
        onSearch={setSearch}
        extra={
          <Select
            className="w-44"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUSES.map((s) => ({ value: s, label: s ? s.replace("_", " ").toLowerCase() : "All statuses" }))}
          />
        }
      />
      <ListCard loading={loading} empty={rows.length === 0}>
        {rows.length === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <TWrap>
            <thead>
              <tr>
                <Th>Invoice #</Th>
                <Th>Client</Th>
                <Th>Due</Th>
                <Th>Total</Th>
                <Th>Paid</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const total = Number(inv.totalMinor);
                const paid = Number(inv.paidMinor);
                const outstanding = total - paid;
                return (
                  <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <Td>
                      <button className="font-mono text-xs font-medium hover:underline" onClick={() => router.push(`/invoices/${inv.id}`)}>
                        {inv.number}
                      </button>
                    </Td>
                    <Td>{inv.client?.name ?? "—"}</Td>
                    <Td className="text-zinc-500">{fmtDate(inv.dueDate)}</Td>
                    <Td className="font-medium">{fmtMoney(total, inv.currency.symbol)}</Td>
                    <Td className={paid > 0 ? "text-emerald-600" : "text-zinc-400"}>{paid > 0 ? fmtMoney(paid, inv.currency.symbol) : "—"}</Td>
                    <Td><StatusBadge value={inv.status} /></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {inv.status === "DRAFT" && (
                          <button onClick={() => act(inv.id, "issue")} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Issue</button>
                        )}
                        {inv.status === "ISSUED" && (
                          <button onClick={() => act(inv.id, "send")} className="rounded px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950">Email</button>
                        )}
                        {openable.includes(inv.status) && outstanding > 0 && (
                          <button onClick={() => act(inv.id, "checkout")} className="rounded px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950">Collect</button>
                        )}
                        {(inv.status === "DRAFT" || inv.status === "ISSUED" || inv.status === "SENT") && (
                          <button onClick={() => act(inv.id, "void", { reason: "Voided from list" })} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Void</button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TWrap>
        )}
      </ListCard>
      {open && <DocumentBuilder open onClose={() => setOpen(false)} kind="INVOICE" onCreated={(id) => router.push(`/invoices/${id}`)} />}
    </div>
  );
}
