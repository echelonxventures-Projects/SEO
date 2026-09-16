"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, EmptyState, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";
import { Play, Trash2 } from "lucide-react";

type Report = { id: string; name: string; module: string; schedule: string; definition: { months: number }; createdAt: string; patternId: string | null; nextScheduledAt: string | null; lastScheduledAt: string | null; pattern?: { name: string; dsl: string | null } | null };
type Result = { columns: Array<{ key: string; label: string; type: string }>; rows: Array<Record<string, unknown>>; summary: Record<string, number> };

const MODULES = [
  { value: "REVENUE", label: "Revenue" },
  { value: "CLIENTS", label: "Clients" },
  { value: "SEO_RANKINGS", label: "SEO rankings" },
  { value: "CAMPAIGNS", label: "Campaigns" },
  { value: "TIMESHEETS", label: "Timesheets" },
  { value: "TEAM", label: "Team activity" },
];

export default function ReportsPage() {
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [module, setModule] = useState("REVENUE");
  const [months, setMonths] = useState("12");
  const [schedule, setSchedule] = useState("NONE");
  const [patternId, setPatternId] = useState("");
  const [patterns, setPatterns] = useState<Array<{ id: string; name: string; dsl: string | null }>>([]);
  const [result, setResult] = useState<{ report: Report; data: Result } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Report[]>("/reports")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { api.get<Array<{ id: string; name: string; dsl: string | null; status: string; freq: string }>>("/temporal/patterns").then((p) => setPatterns(p.filter((x) => x.status === "ACTIVE" && x.freq !== "NONE"))).catch(() => undefined); }, []);

  async function create() {
    if (!name.trim()) {
      toast("error", "Give the report a name");
      return;
    }
    try {
      await api.post("/reports", { name: name.trim(), module, definition: { months: Number(months) }, patternId: patternId || null, schedule: patternId ? "NONE" : schedule });
      setPatternId("");
      setName("");
      toast("success", "Report saved");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  async function run(r: Report) {
    try {
      const data = await api.post<Result>(`/reports/${r.id}/run`);
      setResult({ report: r, data });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Run failed");
    }
  }

  return (
    <div>
      <PageHeader title="Reports" description="Saved, reusable analyses across every module." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader title="New report" />
            <div className="space-y-3 p-4">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly revenue" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              <Select value={module} onChange={(e) => setModule(e.target.value)} options={MODULES} />
              <Select value={months} onChange={(e) => setMonths(e.target.value)} options={["3", "6", "12", "24"].map((m) => ({ value: m, label: `Last ${m} months` }))} />
              <Select value={patternId ? `p:${patternId}` : schedule} onChange={(e) => { const v = e.target.value; if (v.startsWith("p:")) { setPatternId(v.slice(2)); setSchedule("NONE"); } else { setPatternId(""); setSchedule(v); } }} options={[
                { value: "NONE", label: "No schedule (manual runs)" },
                { value: "DAILY", label: "Daily (legacy)" },
                { value: "WEEKLY", label: "Weekly (legacy)" },
                { value: "MONTHLY", label: "Monthly (legacy)" },
                ...patterns.map((p) => ({ value: `p:${p.id}`, label: `⏱ ${p.name}${p.dsl ? ` · ${p.dsl}` : ""}` })),
              ]} />
              <Button size="sm" className="w-full" onClick={create}>Save report</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Saved reports" />
            {loading ? (
              <div className="p-4 text-sm text-zinc-400">Loading…</div>
            ) : rows.length === 0 ? (
              <EmptyState title="No reports yet" />
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <button onClick={() => run(r)} className="text-left">
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-zinc-400">{MODULES.find((m) => m.value === r.module)?.label}
                        {(r.pattern?.dsl || r.schedule !== "NONE") && <span className="ml-1 text-indigo-500">↻ {r.pattern ? r.pattern.dsl ?? r.pattern.name : r.schedule.toLowerCase()}
                          {r.nextScheduledAt ? ` · next ${new Date(r.nextScheduledAt).toISOString().slice(0, 10)}` : ""}</span>}
                      </p>
                    </button>
                    <div className="flex gap-1">
                      <button onClick={() => run(r)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Run"><Play className="h-4 w-4" /></button>
                      <button onClick={async () => { try { await api.del(`/reports/${r.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950" title="Delete"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          {!result ? (
            <Card><EmptyState title="Select a report to run" hint="Pick one from the left, or save a new one." /></Card>
          ) : (
            <Card>
              <CardHeader
                title={result.report.name}
                description={`${result.data.rows.length} rows · ${Object.entries(result.data.summary).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${k.endsWith("Minor") ? fmtMoney(v) : v}`).join(" · ")}`}
              />
              <TWrap>
                <thead>
                  <tr>{result.data.columns.map((c) => <Th key={c.key}>{c.label}</Th>)}</tr>
                </thead>
                <tbody>
                  {result.data.rows.map((row, i) => (
                    <tr key={i}>
                      {result.data.columns.map((c) => (
                        <Td key={c.key} className={c.type === "money" ? "text-right tabular-nums" : c.type === "number" ? "text-right tabular-nums" : ""}>
                          {c.type === "money" ? fmtMoney(Number(row[c.key])) : String(row[c.key] ?? "—")}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </TWrap>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
