"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, EmptyState, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { CrudFormModal, StatusBadge, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { toast } from "@/components/toast";

type Backlink = {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string | null;
  dofollow: boolean;
  domainAuthority: number | null;
  status: string;
  firstSeenAt: string;
};

export default function BacklinksPage() {
  const { projects } = useLookups();
  const [rows, setRows] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ rows: Backlink[] }>("/seo/backlinks?pageSize=200")
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const fields: FieldDef[] = [
    { name: "sourceUrl", label: "Linking page URL", required: true, placeholder: "https://…" },
    { name: "targetUrl", label: "Target (your URL)", required: true, placeholder: "https://…" },
    { name: "anchorText", label: "Anchor text", half: true },
    { name: "domainAuthority", label: "Domain authority", kind: "number", half: true },
    { name: "projectId", label: "Project", kind: "select", options: [{ value: "", label: "—" }, ...projects], half: true },
    { name: "dofollow", label: "DoFollow", kind: "checkbox", default: true },
  ];

  return (
    <div>
      <PageHeader title="Backlinks" description="Referring links, authority and liveness." actions={<Button size="sm" onClick={() => setOpen(true)}>Add backlink</Button>} />
      <Card>
        <CardHeader title="Indexed links" description={`${rows.length} total`} />
        {loading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No backlinks yet" />
        ) : (
          <TWrap>
            <thead><tr><Th>From</Th><Th>To</Th><Th>DA</Th><Th>Type</Th><Th>Status</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <Td><span className="block max-w-64 truncate">{b.sourceUrl}</span>{b.anchorText && <span className="text-xs text-zinc-400">“{b.anchorText}”</span>}</Td>
                  <Td><span className="block max-w-52 truncate text-zinc-500">{b.targetUrl}</span></Td>
                  <Td>{b.domainAuthority ?? "—"}</Td>
                  <Td className="text-zinc-500">{b.dofollow ? "DoFollow" : "NoFollow"}</Td>
                  <Td><StatusBadge value={b.status} /></Td>
                  <Td className="text-right">
                    <button
                      disabled={busyId === b.id}
                      onClick={async () => {
                        setBusyId(b.id);
                        try {
                          const r = await api.post<{ status: string }>(`/seo/backlinks/${b.id}/check`);
                          toast("success", `Link is ${r.status?.toLowerCase() ?? "checked"}`);
                          load();
                        } catch (e) {
                          toast("error", e instanceof Error ? e.message : "Check failed");
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Check
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      <CrudFormModal open={open} onClose={() => setOpen(false)} title="Add backlink" fields={fields} onSubmit={async (p) => { await api.post("/seo/backlinks", p); setOpen(false); load(); }} />
    </div>
  );
}
