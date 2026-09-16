"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, Field, Input, Select, Badge } from "@/components/ui";
import { toast } from "@/components/toast";
import { fmtDate } from "@/lib/format";

type Step = { id: string; key: string; label: string; done: boolean; doneAt: string | null; position: number };
type Def = { id: string; key: string; label: string; type: string; options: string[]; required: boolean };

export function ClientOps({ clientId, initial, permissions }: { clientId: string; initial: Record<string, unknown>; permissions: string[] }) {
  const [steps, setSteps] = useState<{ steps: Step[]; percent: number } | null>(null);
  const [defs, setDefs] = useState<Def[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const canWrite = permissions.includes("client.write");

  const load = useCallback(() => {
    api.get<{ steps: Step[]; percent: number }>(`/clients/${clientId}/onboarding`).then(setSteps).catch(() => {});
    api.get<Def[]>(`/custom-fields?entity=CLIENT`).then(setDefs).catch(() => {});
  }, [clientId]);
  useEffect(load, [load]);

  async function setField(key: string, value: unknown) {
    const next = { ...values, [key]: value };
    setValues(next);
    try {
      await api.patch(`/clients/${clientId}`, { customFields: next });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-4">
      {steps && (
        <Card>
          <CardHeader title="Onboarding" description={
            <span className="flex items-center gap-2">{steps.percent}% complete
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${steps.percent}%` }} /></span>
            </span>
          } />
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {steps.steps.map((st) => (
              <li key={st.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" disabled={!canWrite} checked={st.done} onChange={async () => {
                    setBusy(st.id);
                    try { await api.post(`/clients/${clientId}/onboarding/${st.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); } }
                  } className="h-4 w-4 rounded border-zinc-300" />
                  <span className={st.done ? "text-zinc-400 line-through" : ""}>{st.label}</span>
                </label>
                {st.doneAt && <span className="text-xs text-zinc-400">{fmtDate(st.doneAt)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {defs.length > 0 && (
        <Card>
          <CardHeader title="Custom fields" description="Defined in Settings → Custom fields — type-checked on save" />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {defs.map((d) => (
              <Field key={d.key} label={d.label + (d.required ? " *" : "")}>
                {d.type === "SELECT" ? (
                  <Select value={String(values[d.key] ?? "")} onChange={(e) => setField(d.key, e.target.value)} options={[{ value: "", label: "—" }, ...d.options.map((o) => ({ value: o, label: o }))]} />
                ) : d.type === "BOOL" ? (
                  <Select value={values[d.key] === true ? "1" : values[d.key] === false ? "0" : ""} onChange={(e) => setField(d.key, e.target.value === "1" ? true : e.target.value === "0" ? false : null)} options={[{ value: "", label: "—" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }]} />
                ) : (
                  <Input type={d.type === "NUMBER" ? "number" : d.type === "DATE" ? "date" : "text"} value={String(values[d.key] ?? "")} onChange={(e) => setField(d.key, d.type === "NUMBER" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />
                )}
              </Field>
            ))}
          </div>
        </Card>
      )}
      {busy && <Badge className="hidden">busy</Badge>}
    </div>
  );
}
