"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Input, Modal, TWrap, Th, Td, Field } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";

type Metric = { date: string; impressions: number; clicks: number; cost: number; conversions: number; revenue: number };

export function CampaignMetrics({
  campaignId,
  permissions,
  initial,
}: {
  campaignId: string;
  permissions: string[];
  symbol: string;
  initial: Metric[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const can = permissions.includes("campaign.write");

  useEffect(() => setRows(initial), [initial]);

  return (
    <div>
      {can && (
        <div className="flex justify-end p-3">
          <Button size="sm" onClick={() => setOpen(true)}>Add / update a day</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-zinc-400">No metrics yet — add daily impressions, clicks, cost and conversions.</p>
      ) : (
        <TWrap>
          <thead>
            <tr><Th>Date</Th><Th className="text-right">Impr.</Th><Th className="text-right">Clicks</Th><Th className="text-right">Cost</Th><Th className="text-right">Conv.</Th><Th className="text-right">Revenue</Th></tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((m) => (
              <tr key={m.date}>
                <Td className="text-zinc-500">{fmtDate(m.date)}</Td>
                <Td className="text-right tabular-nums">{m.impressions.toLocaleString("en-IN")}</Td>
                <Td className="text-right tabular-nums">{m.clicks.toLocaleString("en-IN")}</Td>
                <Td className="text-right tabular-nums">₹{m.cost.toLocaleString("en-IN")}</Td>
                <Td className="text-right tabular-nums">{m.conversions}</Td>
                <Td className="text-right tabular-nums text-emerald-600">₹{m.revenue.toLocaleString("en-IN")}</Td>
              </tr>
            ))}
          </tbody>
        </TWrap>
      )}
      {open && <MetricModal campaignId={campaignId} existing={rows} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }} />}
    </div>
  );
}

function MetricModal({ campaignId, existing, onClose, onSaved }: { campaignId: string; existing: Metric[]; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<Metric>(existing[existing.length - 1] ?? { date: new Date().toISOString().slice(0, 10), impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Metric>) => setM((cur) => ({ ...cur, ...patch }));

  return (
    <Modal open onClose={onClose} title="Daily metrics">
      <div className="space-y-3">
        <Field label="Date">
          <Input type="date" value={m.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impressions"><Input type="number" min="0" value={m.impressions} onChange={(e) => set({ impressions: Number(e.target.value) })} /></Field>
          <Field label="Clicks"><Input type="number" min="0" value={m.clicks} onChange={(e) => set({ clicks: Number(e.target.value) })} /></Field>
          <Field label="Cost (₹)"><Input type="number" step="0.01" min="0" value={m.cost} onChange={(e) => set({ cost: Number(e.target.value) })} /></Field>
          <Field label="Conversions"><Input type="number" min="0" value={m.conversions} onChange={(e) => set({ conversions: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Attributed revenue (₹)"><Input type="number" step="0.01" min="0" value={m.revenue} onChange={(e) => set({ revenue: Number(e.target.value) })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/campaigns/${campaignId}/metrics`, m);
              toast("success", "Metrics saved");
              onSaved();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
