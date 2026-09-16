"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, EmptyState, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { CrudFormModal, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { toast } from "@/components/toast";
import { ArrowDown, ArrowUp, Minus, RefreshCw } from "lucide-react";

type Row = {
  id: string;
  term: string;
  device: string;
  location: string | null;
  currentPosition: number | null;
  previousPosition: number | null;
  change: number | null;
  series: Array<{ date: string; position: number }>;
};

export default function KeywordsPage() {
  const { projects } = useLookups();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{ keywords: number; top10: number; improved: number; declined: number; avgPosition: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [snapshotFor, setSnapshotFor] = useState<Row | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get<{ rows: Row[] }>("/seo/keywords?pageSize=200"), api.get("/seo/summary")])
      .then(([k, s]) => {
        setRows(k.rows);
        setSummary(s as never);
      })
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await api.post<{ written: number }>("/seo/snapshots/refresh");
      toast("success", `Refreshed ${r.written} keywords (demo provider)`);
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setRefreshing(false);
    }
  }

  const addFields: FieldDef[] = [
    { name: "term", label: "Keyword", required: true, half: true },
    { name: "device", label: "Device", kind: "select", default: "DESKTOP", options: [{ value: "DESKTOP", label: "Desktop" }, { value: "MOBILE", label: "Mobile" }], half: true },
    { name: "projectId", label: "Project", kind: "select", options: [{ value: "", label: "—" }, ...projects], half: true },
    { name: "targetUrl", label: "Ranking URL", placeholder: "https://…", half: true },
  ];
  const snapFields: FieldDef[] = [
    { name: "capturedOn", label: "Captured on", kind: "date", required: true, default: new Date().toISOString().slice(0, 10), half: true },
    { name: "position", label: "Position (0 = not found)", kind: "number", required: true, half: true },
  ];

  const s = summary as unknown as { top10?: number; improved?: number; declined?: number; avgPosition?: number | null; keywords?: number } | null;

  return (
    <div>
      <PageHeader
        title="Rankings"
        description="Track keyword positions across devices and locations."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={refreshing} onClick={refresh}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            <Button size="sm" onClick={() => setAdding(true)}>Track keyword</Button>
          </div>
        }
      />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Mini label="Tracked" value={String(s.keywords ?? 0)} />
          <Mini label="Top 10" value={String(s.top10 ?? 0)} />
          <Mini label="Improved (wk)" value={String(s.improved ?? 0)} tone="good" />
          <Mini label="Avg position" value={s.avgPosition ? String(s.avgPosition) : "—"} />
        </div>
      )}
      <Card>
        <CardHeader title="Keywords" description={`${rows.length} tracked`} />
        {loading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No keywords tracked" hint="Add your money keywords to monitor movement." />
        ) : (
          <TWrap>
            <thead><tr><Th>Keyword</Th><Th>Device</Th><Th>Position</Th><Th>7-day</Th><Th>Trend</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><p className="font-medium">{r.term}</p>{r.location && <p className="text-xs text-zinc-400">{r.location}</p>}</Td>
                  <Td className="text-zinc-500">{r.device.toLowerCase()}</Td>
                  <Td>{r.currentPosition != null ? <span className="font-semibold">#{r.currentPosition}</span> : <span className="text-zinc-400">—</span>}</Td>
                  <Td>
                    {r.change == null ? <span className="text-zinc-400">new</span> : r.change > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-emerald-600"><ArrowUp className="h-3 w-3" />{r.change}</span>
                    ) : r.change < 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-red-600"><ArrowDown className="h-3 w-3" />{Math.abs(r.change)}</span>
                    ) : (
                      <span className="text-zinc-400"><Minus className="h-3 w-3" /></span>
                    )}
                  </Td>
                  <Td><Spark series={r.series.map((x) => x.position)} /></Td>
                  <Td className="text-right"><button onClick={() => setSnapshotFor(r)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Log rank</button></Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>

      <CrudFormModal open={adding} onClose={() => setAdding(false)} title="Track keyword" fields={addFields} onSubmit={async (p) => { await api.post("/seo/keywords", p); setAdding(false); load(); }} />
      {snapshotFor && (
        <CrudFormModal open key={snapshotFor.id} onClose={() => setSnapshotFor(null)} title={`Log rank — ${snapshotFor.term}`} fields={snapFields} onSubmit={async (p) => { await api.post("/seo/snapshots", { keywordId: snapshotFor.id, ...p }); setSnapshotFor(null); load(); }} />
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "good" ? "text-emerald-600" : ""}`}>{value}</p>
    </Card>
  );
}

function Spark({ series }: { series: number[] }) {
  const pts = series.slice(-12);
  if (pts.length < 2) return <span className="text-xs text-zinc-400">—</span>;
  const max = Math.max(...pts, 1);
  const w = 80;
  const h = 24;
  const step = w / (pts.length - 1);
  // lower position is better → invert y
  const poly = pts.map((p, i) => `${i * step},${(p / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={poly} fill="none" stroke="rgb(16 185 129)" strokeWidth={1.5} />
    </svg>
  );
}
