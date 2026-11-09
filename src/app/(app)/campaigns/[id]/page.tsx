import { notFound } from "next/navigation";
import { clientIp } from "@/server/audit";
import Link from "next/link";
import { headers } from "next/headers";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getCampaignDetail } from "@/server/services/campaign.service";
import { Card, CardHeader, Badge } from "@/components/ui";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { CampaignMetrics } from "./campaign-metrics";
import { LifecyclePanel } from "./lifecycle-panel";
import { FlightsPanel } from "./flights-panel";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: PageProps<"/campaigns/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  let data;
  try {
    data = await getCampaignDetail(ctxOf(viewer, clientIp(h)), id);
  } catch {
    notFound();
  }
  const { campaign, metrics, derived, totals, flights } = data;
  const permissions = [...viewer.active!.permissions];
  const symbol = campaign.currency.symbol;

  return (
    <div>
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All campaigns
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <Badge className="bg-zinc-500/15 text-zinc-600">{(campaign as {channel?:{name:string}|null, mediaChannel?:{name:string}|null}).channel?.name ?? campaign.mediaChannel?.name ?? "channel"}</Badge>
        <Badge className="bg-violet-500/15 text-violet-600">{campaign.status.toLowerCase()}</Badge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Spend" value={fmtMoney(Number(totals.costMinor), symbol)} />
        <Kpi label="Revenue" value={fmtMoney(Number(totals.revenueMinor), symbol)} />
        <Kpi label="ROAS" value={derived.roas ? `${derived.roas}×` : "—"} />
        <Kpi label="Clicks" value={fmtNumber(totals.clicks)} />
        <Kpi label="CTR" value={`${derived.ctrPct}%`} />
      </div>

      <div className="mb-4">
        <LifecyclePanel campaignId={campaign.id} />
      </div>
      <div className="mb-4">
        <FlightsPanel campaignId={campaign.id} permissions={permissions} flights={(flights ?? []).map((f: { id: string; startsAt: Date; endsAt: Date; status: string; budgetMinor: bigint | null; slotsGenerated: number; cadence: unknown; channel: { id: string; code: string; name: string; kind: string }; audience: { id: string; name: string } | null }) => ({
          id: f.id,
          startsAt: f.startsAt.toISOString(),
          endsAt: f.endsAt.toISOString(),
          status: f.status,
          budgetMinor: f.budgetMinor != null ? Number(f.budgetMinor) : null,
          slotsGenerated: f.slotsGenerated,
          cadence: (f.cadence as { days?: number[]; time?: string } | null) ?? null,
          channel: f.channel,
          audience: f.audience,
        }))} />
      </div>
      <Card>
        <CardHeader title="Daily performance" description={`${metrics.length} days tracked`} />
        <CampaignMetrics
          campaignId={campaign.id}
          permissions={permissions}
          symbol={symbol}
          initial={metrics.map((m) => ({
            date: m.date.toISOString().slice(0, 10),
            impressions: Number(m.impressions),
            clicks: Number(m.clicks),
            cost: Number(m.costMinor) / 100,
            conversions: Number(m.conversions),
            revenue: Number(m.revenueMinor) / 100,
          }))}
        />
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}
