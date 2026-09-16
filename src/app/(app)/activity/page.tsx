"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, PageHeader, TWrap, Th, Td, Badge, Input } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { toast } from "@/components/toast";
import { RefreshCw } from "lucide-react";

type Entry = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  user: { name: string } | null;
};


export default function ActivityPage() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const pageSize = 50;

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) p.set("q", search);
    api.get<{ rows: Entry[]; total: number }>(`/activity?${p}`)
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, [page, search]);
  useEffect(load, [load]);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Immutable, append-only audit trail of every change in this workspace."
        actions={
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              placeholder="Filter action…"
              className="w-48"
            />
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
        }
      />
      <Card>
        <TWrap>
          <thead>
            <tr><Th>Action</Th><Th>Who</Th><Th>Entity</Th><Th>IP</Th><Th>When</Th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-zinc-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-400">No activity</td></tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td><Badge className="bg-zinc-500/10 text-zinc-600 font-mono text-[11px]">{a.action}</Badge></Td>
                  <Td>{a.user?.name ?? <span className="text-zinc-400">system</span>}</Td>
                  <Td>{a.entityType ? <span className="text-xs text-zinc-500">{a.entityType.toLowerCase()} · {a.entityId?.slice(-6)}</span> : "—"}</Td>
                  <Td className="font-mono text-xs text-zinc-400">{a.ip ?? "—"}</Td>
                  <Td className="text-xs text-zinc-500">{fmtDateTime(a.createdAt)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TWrap>
        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800">
          <span>{total} events</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
            <button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
