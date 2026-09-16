"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import { toast } from "@/components/toast";

type Link = {
  id: string;
  code: string;
  label: string;
  destination: string;
  clicks: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  campaign: { name: string } | null;
};

export default function LinksPage() {
  const [rows, setRows] = useState<Link[]>([]);
  const [campaigns, setCampaigns] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Link[]>("/links")
      .then((r) => setRows(r.map((l) => ({ ...l, clicks: Number(l.clicks) }))))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
    api.get<{ rows: Array<{ id: string; name: string }> }>("/campaigns?pageSize=200")
      .then((c) => setCampaigns(c.rows.map((r) => ({ value: r.id, label: r.name }))))
      .catch(() => {});
  }, [load]);

  const url = (l: Link) => `${window.location.origin}/go/${l.code}`;

  return (
    <div>
      <PageHeader
        title="Tracked links"
        description="Short links that attach campaign UTMs and count every click."
        actions={<Button size="sm" onClick={() => setOpen(true)}>New link</Button>}
      />
      <Card>
        <CardHeader title="Links" description={`${rows.length} total · ${fmtNumber(rows.reduce((a, l) => a + (l.clicks || 0), 0))} clicks`} />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No tracked links" hint="Create one per channel placement to measure clicks." />
        ) : (
          <TWrap>
            <thead><tr><Th>Label</Th><Th>Short link</Th><Th>Campaign</Th><Th>UTM</Th><Th className="text-right">Clicks</Th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <Td><p className="font-medium">{l.label}</p><p className="max-w-64 truncate text-xs text-zinc-400">{l.destination}</p></Td>
                  <Td>
                    <button
                      className="font-mono text-xs text-sky-600 hover:underline"
                      onClick={() => navigator.clipboard?.writeText(url(l)).then(() => toast("success", "Link copied"))}
                      title="Copy link"
                    >
                      /go/{l.code}
                    </button>
                  </Td>
                  <Td>{l.campaign?.name ?? "—"}</Td>
                  <Td className="text-xs text-zinc-500">
                    {[l.utmSource, l.utmMedium, l.utmCampaign].filter(Boolean).join(" / ") || "—"}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    <Badge className="bg-zinc-500/10 text-zinc-600">{fmtNumber(l.clicks)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      {open && <LinkModal campaigns={campaigns} onClose={() => setOpen(false)} onDone={load} />}
    </div>
  );
}

function LinkModal({ campaigns, onClose, onDone }: { campaigns: Array<{ value: string; label: string }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ label: "", destination: "", campaignId: "", utmSource: "", utmMedium: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New tracked link">
      <div className="space-y-3">
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Instagram bio" /></Field>
        <Field label="Destination URL"><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="https://…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Campaign (fills utm_campaign)" hint="Select to default utm_medium=paid">
            <Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })} options={[{ value: "", label: "None" }, ...campaigns]} />
          </Field>
          <Field label="utm_source"><Input value={f.utmSource} onChange={(e) => setF({ ...f, utmSource: e.target.value })} placeholder="instagram" /></Field>
          <Field label="utm_medium"><Input value={f.utmMedium} onChange={(e) => setF({ ...f, utmMedium: e.target.value })} placeholder="organic / paid / email" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/links", {
                label: f.label,
                destination: f.destination,
                campaignId: f.campaignId || null,
                utmSource: f.utmSource || null,
                utmMedium: f.utmMedium || null,
              });
              toast("success", "Link created");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Create link</Button>
        </div>
      </div>
    </Modal>
  );
}
