"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus } from "lucide-react";

type Channel = {
  id: string;
  code: string;
  name: string;
  kind: string;
  costModel: string;
  capabilities: string[];
  connectorKey: string | null;
  utmMedium: string;
  budgetCapMinor: number | null;
  active: boolean;
  ready: boolean;
  orgId: string | null;
};

const KINDS = ["SEARCH", "SOCIAL", "DISPLAY", "VIDEO", "EMAIL", "WHATSAPP", "SMS", "AFFILIATE", "ORGANIC", "DIRECT_MAIL", "MARKETPLACE"];

export default function ChannelsPage() {
  const [rows, setRows] = useState<Channel[]>([]);
  const [nets, setNets] = useState<Array<{ key: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Channel[]>("/channels")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
    api.get<Array<{ key: string; name: string }>>("/social/networks").then(setNets).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const groups: Array<[string, Channel[]]> = Object.entries(
    rows.reduce<Record<string, Channel[]>>((acc, c) => {
      const scope = c.orgId ? "Workspace channels" : "Platform catalog";
      (acc[scope] ??= []).push(c);
      return acc;
    }, {}),
  );

  return (
    <div>
      <PageHeader
        title="Media channels"
        description="Every place you can deliver — platform defaults plus your own. Readiness reflects live connections."
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New channel</Button>}
      />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60" />)}</div>
      ) : (
        groups.map(([label, list]) => (
          <div key={label} className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <Card key={c.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs text-zinc-400">{c.code} · {c.kind.toLowerCase()} · {c.costModel.toLowerCase()}</p>
                    </div>
                    <Badge className={c.ready ? "bg-emerald-500/15 text-emerald-600" : c.active ? "bg-amber-500/15 text-amber-600" : "bg-zinc-500/15 text-zinc-500"}>
                      {c.ready ? "ready" : c.active ? "needs connection" : "off"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.capabilities.map((cap) => (
                      <span key={cap} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{cap}</span>
                    ))}
                    {c.connectorKey && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600">{c.connectorKey}</span>}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    utm: {c.utmMedium}
                    {c.budgetCapMinor ? ` · cap ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(c.budgetCapMinor / 100)}/flight` : ""}
                  </p>
                  {c.orgId && (
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={async () => {
                        try { await api.post(`/channels/${c.id}/toggle`, { active: !c.active }); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                      }}>{c.active ? "Disable" : "Enable"}</Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
      {open && <ChannelModal nets={nets} onClose={() => setOpen(false)} onDone={load} />}
    </div>
  );
}

function ChannelModal({ nets, onClose, onDone }: { nets: Array<{ key: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: "", name: "", kind: "SEARCH", costModel: "CPC", connectorKey: "", utmMedium: "paid", budgetCap: "" });
  const [busy, setBusy] = useState(false);
  const needsConnector = f.kind === "SOCIAL" || f.kind === "VIDEO";
  return (
    <Modal open onClose={onClose} title="New media channel">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="REDDIT_ADS" /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS.map((k) => ({ value: k, label: k.toLowerCase() }))} /></Field>
        <Field label="Cost model"><Select value={f.costModel} onChange={(e) => setF({ ...f, costModel: e.target.value })} options={["CPC", "CPM", "CPA", "FLAT", "FREE"].map((k) => ({ value: k, label: k }))} /></Field>
        {needsConnector && (
          <Field label="Connector (publishing)" className="col-span-2">
            <Select value={f.connectorKey} onChange={(e) => setF({ ...f, connectorKey: e.target.value })} options={[{ value: "", label: "—" }, ...nets.map((n) => ({ value: n.key, label: n.name }))]} />
          </Field>
        )}
        <Field label="utm_medium"><Input value={f.utmMedium} onChange={(e) => setF({ ...f, utmMedium: e.target.value })} /></Field>
        <Field label="Budget cap per flight (optional)"><Input type="number" min="0" value={f.budgetCap} onChange={(e) => setF({ ...f, budgetCap: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/channels", {
                code: f.code,
                name: f.name,
                kind: f.kind,
                costModel: f.costModel,
                connectorKey: needsConnector ? f.connectorKey || null : null,
                utmMedium: f.utmMedium,
                budgetCap: f.budgetCap ? Number(f.budgetCap) : null,
              });
              toast("success", "Channel created");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}
