"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, EmptyState, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { ListCard, StatusBadge, Toolbar } from "@/components/crud";
import { DocumentBuilder } from "@/components/document-builder";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";

type Quote = {
  id: string;
  number: string;
  status: string;
  totalMinor: number | bigint;
  currency: { symbol: string };
  issueDate: string;
  validUntil: string | null;
  client: { name: string };
};

export default function QuotesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ pageSize: "100" });
    if (search) p.set("q", search);
    api
      .get<{ rows: Quote[] }>(`/quotes?${p}`)
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, [search]);
  useEffect(load, [load]);

  async function act(id: string, action: string, body?: unknown) {
    try {
      await api.post(`/quotes/${id}/${action}`, body ?? {});
      toast("success", "Done");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader title="Quotes" description="Proposals → accept → convert to invoice." actions={<Button size="sm" onClick={() => setOpen(true)}>New quote</Button>} />
      <Toolbar search={search} onSearch={setSearch} />
      <ListCard loading={loading} empty={rows.length === 0}>
        {rows.length === 0 ? (
          <EmptyState title="No quotes yet" />
        ) : (
          <TWrap>
            <thead>
              <tr>
                <Th>Quote #</Th>
                <Th>Client</Th>
                <Th>Issued</Th>
                <Th>Valid until</Th>
                <Th>Total</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const total = Number(q.totalMinor);
                return (
                  <tr key={q.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <Td>
                      <button className="font-mono text-xs font-medium hover:underline" onClick={() => router.push(`/quotes/${q.id}`)}>
                        {q.number}
                      </button>
                    </Td>
                    <Td>{q.client.name}</Td>
                    <Td className="text-zinc-500">{fmtDate(q.issueDate)}</Td>
                    <Td className="text-zinc-500">{fmtDate(q.validUntil)}</Td>
                    <Td className="font-medium">{fmtMoney(total, q.currency.symbol)}</Td>
                    <Td><StatusBadge value={q.status} /></Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {q.status === "DRAFT" && (
                          <button onClick={() => act(q.id, "send")} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Send</button>
                        )}
                        {q.status === "SENT" && (
                          <>
                            <button onClick={() => act(q.id, "decision", { accept: true })} className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">Accept</button>
                            <button onClick={() => act(q.id, "decision", { accept: false })} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Decline</button>
                          </>
                        )}
                        {q.status === "ACCEPTED" && (
                          <button onClick={() => act(q.id, "convert")} className="rounded px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950">Convert → invoice</button>
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
      {open && <DocumentBuilder open onClose={() => setOpen(false)} kind="QUOTE" onCreated={(id) => router.push(`/quotes/${id}`)} />}
    </div>
  );
}
