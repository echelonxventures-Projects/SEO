"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";
import { Plus } from "lucide-react";

type Offer = {
  id: string;
  code: string;
  name: string;
  kind: string;
  valueType: string;
  value: number;
  status: string;
  maxRedemptions: number | null;
  perRecipientLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  client: { name: string } | null;
  _count: { redemptions: number; campaigns: number };
};
type Detail = {
  offer: Offer & { terms: string | null; minSpendMinor: number | bigint | null; description: string | null };
  redemptions: Array<{ id: string; email: string | null; discountMinor: number | bigint; at: string; invoiceId: string | null }>;
  uniqueRecipients: number;
};

const NEXT: Record<string, Array<{ to: string; label: string }>> = {
  DRAFT: [{ to: "PENDING_APPROVAL", label: "Submit for approval" }],
  PENDING_APPROVAL: [{ to: "APPROVED", label: "Approve" }, { to: "DRAFT", label: "Return to draft" }],
  APPROVED: [{ to: "PUBLISHED", label: "Publish" }],
  PUBLISHED: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [{ to: "EXPIRED", label: "Expire now" }],
  EXPIRED: [],
  ARCHIVED: [],
};

export default function OffersPage() {
  const [rows, setRows] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Offer[]>("/offers")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      await api.post(`/offers/${id}/status`, { status });
      toast("success", `Offer ${status.toLowerCase()}`);
      load();
      if (detail?.offer.id === id) setDetail(await api.get<Detail>(`/offers/${id}`));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Offers"
        description="Discounts, coupons, bundles, loyalty — full lifecycle with capped, audited redemptions."
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New offer</Button>}
      />
      <Card>
        <CardHeader title="Offers" description={`${rows.length} total`} />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No offers yet" hint="Create a coupon, then walk it through approval → publish → activate." />
        ) : (
          <TWrap>
            <thead><tr><Th>Offer</Th><Th>Value</Th><Th>Window</Th><Th>Redemptions</Th><Th>Status</Th><Th className="text-right">Lifecycle</Th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <button className="text-left" onClick={async () => { try { setDetail(await api.get<Detail>(`/offers/${o.id}`)); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>
                      <p className="font-medium"><span className="mr-2 rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-xs text-violet-600">{o.code}</span>{o.name}</p>
                      <p className="text-xs text-zinc-400">{o.kind.toLowerCase()} · {o.client?.name ?? "all clients"}</p>
                    </button>
                  </Td>
                  <Td>{o.valueType === "PERCENT" ? `${(o.value / 100).toFixed(1)}%` : o.valueType === "AMOUNT" ? fmtMoney(o.value) : o.valueType === "POINTS" ? `${o.value} pts` : "1 item"}</Td>
                  <Td className="text-xs text-zinc-500">{o.startsAt ? fmtDate(o.startsAt) : "—"} → {o.endsAt ? fmtDate(o.endsAt) : "open"}</Td>
                  <Td className="text-zinc-500">{o._count.redemptions}{o.maxRedemptions ? ` / ${o.maxRedemptions}` : ""}</Td>
                  <Td><StatusBadge value={o.status} /></Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {(NEXT[o.status] ?? []).map((t) => (
                        <button key={t.to} disabled={busyId === o.id} onClick={() => setStatus(o.id, t.to)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800">{t.label}</button>
                      ))}
                      {!["ARCHIVED"].includes(o.status) && (
                        <button disabled={busyId === o.id} onClick={() => setStatus(o.id, "ARCHIVED")} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950">Archive</button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onDone={load} />}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.offer.code} — ${detail.offer.name}`} wide>
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Redemptions" value={String(detail.redemptions.length)} />
            <Stat label="Unique recipients" value={String(detail.uniqueRecipients)} />
            <Stat label="Discount given" value={fmtMoney(detail.redemptions.reduce((a, r) => a + Number(r.discountMinor), 0))} />
          </div>
          {detail.offer.terms && <p className="mb-3 text-xs text-zinc-500">{detail.offer.terms}</p>}
          <div className="max-h-64 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/40"><th className="px-3 py-2">Recipient</th><th className="px-3 py-2">Discount</th><th className="px-3 py-2">When</th></tr></thead>
              <tbody>
                {detail.redemptions.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">{r.email ?? "identified recipient"}</td>
                    <td className="px-3 py-2">{fmtMoney(Number(r.discountMinor))}</td>
                    <td className="px-3 py-2 text-zinc-500">{fmtDate(r.at)}</td>
                  </tr>
                ))}
                {detail.redemptions.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-zinc-400">No redemptions yet — use the code on an invoice</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    code: "", name: "", kind: "COUPON", valueType: "PERCENT", percent: "10", amount: "",
    maxRedemptions: "", perRecipientLimit: "1", minSpend: "", startsAt: "", endsAt: "", terms: "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New offer" wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint="clients redeem with this"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="DIWALI10" /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={["DISCOUNT", "COUPON", "PROMOTION", "BUNDLE", "REFERRAL", "LOYALTY", "MEMBERSHIP"].map((k) => ({ value: k, label: k.toLowerCase() }))} /></Field>
        <Field label="Value type"><Select value={f.valueType} onChange={(e) => setF({ ...f, valueType: e.target.value })} options={[
          { value: "PERCENT", label: "Percent off" }, { value: "AMOUNT", label: "Fixed amount off" }, { value: "POINTS", label: "Loyalty points" }, { value: "FREE_ITEM", label: "Free item (manual fulfilment)" },
        ]} /></Field>
        {f.valueType === "PERCENT" && <Field label="Percent"><Input type="number" min="0.1" max="100" step="0.5" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>}
        {f.valueType === "AMOUNT" && <Field label="Amount"><Input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
        {f.valueType === "POINTS" && <Field label="Points"><Input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
        <Field label="Min spend (optional)"><Input type="number" min="0" value={f.minSpend} onChange={(e) => setF({ ...f, minSpend: e.target.value })} /></Field>
        <Field label="Max redemptions (optional)"><Input type="number" min="1" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} /></Field>
        <Field label="Per recipient"><Input type="number" min="1" value={f.perRecipientLimit} onChange={(e) => setF({ ...f, perRecipientLimit: e.target.value })} /></Field>
        <Field label="Starts (optional)"><Input type="date" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Ends (optional)"><Input type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <Field label="Terms" className="col-span-2"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/offers", {
                code: f.code, name: f.name, kind: f.kind, valueType: f.valueType,
                percent: f.valueType === "PERCENT" ? Number(f.percent) : null,
                amount: f.valueType === "AMOUNT" ? Number(f.amount) : null,
                points: f.valueType === "POINTS" ? Number(f.amount) : null,
                minSpend: f.minSpend ? Number(f.minSpend) : null,
                maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null,
                perRecipientLimit: Number(f.perRecipientLimit) || 1,
                startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00:00Z`).toISOString() : null,
                endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59Z`).toISOString() : null,
                terms: f.terms || null,
              });
              toast("success", "Offer created (draft)");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Create offer</Button>
        </div>
      </div>
    </Modal>
  );
}
