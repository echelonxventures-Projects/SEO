"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, EmptyState, PageHeader, TWrap, Th, Td } from "@/components/ui";
import { CrudFormModal, ListCard, StatusBadge, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";

type Campaign = {
  id: string;
  name: string;
  status: string;
  client: { name: string };
  channel: { name: string };
  totals: { costMinor: number | bigint; revenueMinor: number | bigint; clicks: number; conversions: number };
};

export default function CampaignsPage() {
  const router = useRouter();
  const { clients, projects, channels } = useLookups();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ rows: Campaign[] }>("/campaigns?pageSize=100")
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const fields: FieldDef[] = [
    { name: "name", label: "Campaign name", required: true, half: true },
    { name: "clientId", label: "Client", kind: "select", options: clients, required: true, half: true },
    { name: "channelId", label: "Channel", kind: "select", options: channels, required: true, half: true },
    { name: "projectId", label: "Project", kind: "select", options: [{ value: "", label: "—" }, ...projects], half: true },
    { name: "budget", label: "Budget", kind: "money", half: true },
    { name: "startDate", label: "Start date", kind: "date", half: true },
    { name: "endDate", label: "End date", kind: "date", half: true },
  ];

  return (
    <div>
      <PageHeader title="Campaigns" description="Track spend and outcomes across every marketing channel." actions={<Button size="sm" onClick={() => setOpen(true)}>New campaign</Button>} />
      <ListCard loading={loading} empty={rows.length === 0}>
        {rows.length === 0 ? (
          <EmptyState title="No campaigns yet" hint="Add one to monitor spend vs revenue." />
        ) : (
          <TWrap>
            <thead>
              <tr><Th>Campaign</Th><Th>Channel</Th><Th>Spend</Th><Th>Revenue</Th><Th>Clicks</Th><Th>Conv.</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" onClick={() => router.push(`/campaigns/${c.id}`)}>
                  <Td><p className="font-medium">{c.name}</p><p className="text-xs text-zinc-400">{c.client.name}</p></Td>
                  <Td className="text-zinc-500">{c.channel.name}</Td>
                  <Td>{fmtMoney(Number(c.totals.costMinor))}</Td>
                  <Td className="text-emerald-600">{fmtMoney(Number(c.totals.revenueMinor))}</Td>
                  <Td>{c.totals.clicks.toLocaleString("en-IN")}</Td>
                  <Td>{c.totals.conversions.toLocaleString("en-IN")}</Td>
                  <Td><StatusBadge value={c.status} /></Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </ListCard>
      <CrudFormModal open={open} onClose={() => setOpen(false)} title="New campaign" fields={fields} onSubmit={async (p) => { await api.post("/campaigns", p); setOpen(false); load(); }} />
    </div>
  );
}
