"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";

type Tpl = { id: string; code: string; kind: string; name: string; industry: string | null; description: string | null; isGlobal: boolean };
type Rule = { id: string; name: string; type: string; hard: boolean; priority: number; isLibrary: boolean; active: boolean };
type HolidayCal = { id: string; code: string; name: string; scope: string; country: string | null; _count: { entries: number } };
type Fiscal = { id: string; code: string; name: string; anchorMonth: number; period: string };
type TimeSys = { id: string; code: string; name: string; kind: string; utcOffsetMinutes: number; unitSeconds: number; label: string };

export default function LibraryPage() {
  const [tab, setTab] = useState<"templates" | "rules" | "holidays" | "fiscal" | "times" | "astro">("templates");
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [hols, setHols] = useState<HolidayCal[]>([]);
  const [fis, setFis] = useState<Fiscal[]>([]);
  const [tss, setTss] = useState<TimeSys[]>([]);
  const [converting, setConverting] = useState<{ code: string; result: unknown } | null>(null);
  const [astro, setAstro] = useState<{ result: unknown } | null>(null);

  const load = useCallback(() => {
    api.get<Tpl[]>("/temporal/library").then(setTpls).catch((e) => toast("error", e.message));
    api.get<Rule[]>("/temporal/rules").then(setRules).catch(() => undefined);
    api.get<HolidayCal[]>("/temporal/holidays").then(setHols).catch(() => undefined);
    api.get<Fiscal[]>("/temporal/fiscal").then(setFis).catch(() => undefined);
    api.get<TimeSys[]>("/temporal/time-systems").then(setTss).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const instantiate = async (t: Tpl) => {
    try {
      const r = await api.post<{ created: Record<string, string[]> }>(`/temporal/library/${t.id}/instantiate`, {});
      const made = Object.entries(r.created).map(([k, v]) => `${v.length} ${k}`).filter((x) => !x.startsWith("0"));
      toast("success", made.length ? `Instantiated: ${made.join(", ")}` : "Template had nothing to instantiate");
    } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
  };

  const TABS = [
    ["templates", "Library templates"],
    ["rules", "Constraint rules"],
    ["holidays", "Holiday calendars"],
    ["fiscal", "Fiscal calendars"],
    ["times", "Time systems"],
    ["astro", "Astronomical"],
  ] as const;

  return (
    <div>
      <PageHeader title="Temporal library" description="Business hours, trading hours, holiday & fiscal calendars, maintenance windows, shift & industry packs, custom time systems — platforms as data." />
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-indigo-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{label}</button>
        ))}
      </div>

      {tab === "templates" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tpls.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between">
                <p className="font-semibold">{t.name}</p>
                <Badge className="bg-indigo-500/10 text-indigo-600">{t.kind.toLowerCase().replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-400">{t.description}</p>
              <p className="mt-1 text-[10px] uppercase text-zinc-400">{t.industry} · {t.isGlobal ? "platform" : "workspace"}</p>
              <Button size="sm" className="mt-2" onClick={() => instantiate(t)}>Instantiate → workspace</Button>
            </Card>
          ))}
        </div>
      )}

      {tab === "rules" && (
        <Card><TWrap>
          <thead><tr><Th>Rule</Th><Th>Type</Th><Th>Strength</Th><Th>Priority</Th><Th>Scope</Th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <Td className="font-medium">{r.name}</Td>
              <Td>{r.type.toLowerCase().replace(/_/g, " ")}</Td>
              <Td><Badge className={r.hard ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-600"}>{r.hard ? "hard" : "soft"}</Badge></Td>
              <Td className="tabular-nums">{r.priority}</Td>
              <Td>{r.isLibrary ? "platform" : "workspace"}</Td>
            </tr>
          ))}</tbody>
        </TWrap></Card>
      )}

      {tab === "holidays" && (
        <Card><TWrap>
          <thead><tr><Th>Calendar</Th><Th>Code</Th><Th>Scope</Th><Th>Entries</Th></tr></thead>
          <tbody>{hols.map((h) => (
            <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <Td className="font-medium">{h.name}</Td>
              <Td><span className="font-mono text-xs">{h.code}</span></Td>
              <Td>{h.scope.toLowerCase()}{h.country ? ` · ${h.country}` : ""}</Td>
              <Td className="tabular-nums">{h._count.entries}</Td>
            </tr>
          ))}</tbody>
        </TWrap></Card>
      )}

      {tab === "fiscal" && (
        <Card><TWrap>
          <thead><tr><Th>Fiscal calendar</Th><Th>Anchor month</Th><Th>Period</Th></tr></thead>
          <tbody>{fis.map((f) => (
            <tr key={f.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <Td className="font-medium">{f.name} <span className="font-mono text-xs text-zinc-400">({f.code})</span></Td>
              <Td>{new Date(2026, f.anchorMonth - 1, 1).toLocaleString("en", { month: "long" })}</Td>
              <Td>{f.period}</Td>
            </tr>
          ))}</tbody>
        </TWrap></Card>
      )}

      {tab === "times" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><TWrap>
            <thead><tr><Th>Code</Th><Th>System</Th><Th>Kind</Th><Th>Offset</Th><Th>Day length</Th></tr></thead>
            <tbody>{tss.map((t) => (
              <tr key={t.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <Td><span className="font-mono text-xs font-semibold">{t.code}</span></Td>
                <Td>{t.name}</Td>
                <Td>{t.kind.toLowerCase()}</Td>
                <Td className="tabular-nums">{t.utcOffsetMinutes >= 0 ? "+" : ""}{(t.utcOffsetMinutes / 60).toFixed(1)}h</Td>
                <Td className="tabular-nums text-xs">{t.unitSeconds === 86400 ? "24h" : `${(t.unitSeconds / 3600).toFixed(3)}h`} · {t.label}</Td>
              </tr>
            ))}</tbody>
          </TWrap></Card>
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Convert an instant</p>
            <div className="grid gap-2">
              <Field label="Time system"><Input id="ts-code" defaultValue="MARS_SOL" /></Field>
              <Field label="UTC instant"><Input id="ts-at" defaultValue={new Date().toISOString()} /></Field>
              <Button onClick={async () => {
                const code = (document.getElementById("ts-code") as HTMLInputElement).value;
                const at = (document.getElementById("ts-at") as HTMLInputElement).value;
                try { setConverting({ code, result: await api.get(`/temporal/time-systems/convert?code=${encodeURIComponent(code)}&at=${encodeURIComponent(at)}`) }); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
              }}>Convert</Button>
              {converting && <pre className="overflow-auto rounded bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{JSON.stringify(converting.result, null, 2)}</pre>}
            </div>
          </Card>
        </div>
      )}

      {tab === "astro" && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Astronomical resolver — sunrise/sunset/moon for any coordinate</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Field label="Lat"><Input id="ast-lat" defaultValue="19.076" /></Field>
            <Field label="Lng"><Input id="ast-lng" defaultValue="72.8777" /></Field>
            <Field label="Event"><Input id="ast-ev" defaultValue="SUNRISE" /></Field>
            <div className="flex items-end"><Button onClick={async () => {
              const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
              try {
                const r = await api.post("/temporal/dsl/compile", { dsl: `AT ${v("ast-ev")}` });
                setAstro({ result: r });
                toast("success", "compiled anchor (fires resolved per-day against geo)");
              } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            }}>Resolve</Button></div>
          </div>
          {astro && <pre className="mt-3 overflow-auto rounded bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{JSON.stringify(astro.result, null, 2)}</pre>}
        </Card>
      )}
    </div>
  );
}
