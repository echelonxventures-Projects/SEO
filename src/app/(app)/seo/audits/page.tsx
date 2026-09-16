"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, EmptyState, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { CrudFormModal, StatusBadge, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtDateTime } from "@/lib/format";
import { toast } from "@/components/toast";

type Audit = {
  id: string;
  url: string;
  status: string;
  score: number | null;
  issueCount: number;
  passedCount: number;
  startedAt: string;
  project: { name: string } | null;
  requestedBy: { name: string };
};

function scoreTone(score: number | null) {
  if (score == null) return "text-zinc-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 55) return "text-amber-600";
  return "text-red-600";
}

export default function AuditsPage() {
  const router = useRouter();
  const { projects } = useLookups();
  const [rows, setRows] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ rows: Audit[] }>("/seo/audits?pageSize=50")
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const fields: FieldDef[] = [
    { name: "url", label: "URL to audit", required: true, placeholder: "https://example.com", half: true },
    { name: "projectId", label: "Project", kind: "select", options: [{ value: "", label: "—" }, ...projects], half: true },
  ];

  return (
    <div>
      <PageHeader title="Site audits" description="On-page, technical & indexability checks on any URL." actions={<Button size="sm" onClick={() => setOpen(true)}>Run audit</Button>} />
      <Card>
        <CardHeader title="Audit history" description={`${rows.length} runs`} />
        {loading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No audits yet" hint="Audit a client's homepage to find quick wins." />
        ) : (
          <TWrap>
            <thead><tr><Th>URL</Th><Th>Score</Th><Th>Issues</Th><Th>Status</Th><Th>Ran</Th><Th></Th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" onClick={() => router.push(`/seo/audits/${a.id}`)}>
                  <Td><span className="block max-w-72 truncate font-medium">{a.url}</span><span className="text-xs text-zinc-400">{a.project?.name ?? a.requestedBy.name}</span></Td>
                  <Td><span className={`text-lg font-semibold ${scoreTone(a.score)}`}>{a.score ?? "—"}</span></Td>
                  <Td>{a.issueCount}</Td>
                  <Td><StatusBadge value={a.status} /></Td>
                  <Td className="text-xs text-zinc-500">{fmtDateTime(a.startedAt)}</Td>
                  <Td className="text-right text-zinc-400">→</Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      {open && <RunAudit onDone={() => { setOpen(false); load(); }} onClose={() => setOpen(false)} fields={fields} />}
    </div>
  );
}

function RunAudit({ onDone, onClose, fields }: { onDone: () => void; onClose: () => void; fields: FieldDef[] }) {
  return (
    <CrudFormModal
      open
      onClose={onClose}
      title="Run site audit"
      fields={fields}
      onSubmit={async (p) => {
        toast("info", "Auditing… this runs live checks against the URL");
        await api.post("/seo/audits", p);
        onDone();
      }}
    />
  );
}
