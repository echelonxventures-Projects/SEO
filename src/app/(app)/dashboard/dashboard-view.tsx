"use client";

import { Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { fmtMoney, fmtDateTime, fmtNumber, statusClass } from "@/lib/format";
import { CampaignBars, RevenueArea, TimeBars } from "@/components/charts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Clock,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";

type Props = {
  data: {
    currency: { code: string; symbol: string };
    kpis: Record<string, number | null | Record<string, unknown>>;
    revenueByMonth: Array<{ month: string; amount: number }>;
    campaignByMonth: Array<{ month: string; cost: number; revenue: number }>;
    timeByMember: Array<{ name: string; minutes: number }>;
    recentPayments: Array<{ id: string; number: string; client: string | null; invoice: string | null; amountMinor: number; paidAt: Date; method: string }>;
    activity: Array<{ id: string; action: string; user: string; at: Date }>;
  };
  roleCode: string;
};

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        <Icon className="h-4 w-4 text-zinc-400" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
      {tone === "good" && <p className="mt-1 text-xs text-emerald-500">positive</p>}
    </Card>
  );
}

export function DashboardView({ data }: Props) {
  const k = data.kpis as Record<string, number>;
  const symbol = data.currency.symbol || "₹";
  const seo = (k.seo ?? {}) as { improved?: number; declined?: number; top10?: number; avgPosition?: number | null; keywords?: number };
  const collected = data.kpis.collectedMinor as number;
  const outstanding = data.kpis.outstandingMinor as number;
  const overdue = data.kpis.overdueMinor as number;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Live performance for the last 12 months · all amounts in {data.currency.code}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Collected" value={fmtMoney(collected, symbol)} icon={Banknote} sub="payments received" />
        <Stat label="Outstanding" value={fmtMoney(outstanding, symbol)} icon={Receipt} sub={`${(data.kpis.outstandingCount as number) ?? 0} open invoices`} />
        <Stat label="Overdue" value={fmtMoney(overdue, symbol)} icon={TrendingUp} sub={`${(data.kpis.overdueCount as number) ?? 0} past due`} />
        <Stat label="Pipeline" value={fmtMoney(data.kpis.pipelineMinor as number, symbol)} icon={Users} sub={`${fmtNumber(data.kpis.openLeads as number)} open leads`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue collected" description="Payments by month" />
          <div className="p-4">
            {data.revenueByMonth.some((r) => r.amount > 0) ? (
              <RevenueArea data={data.revenueByMonth} symbol={symbol} />
            ) : (
              <EmptyState title="No payments yet" hint="Recorded and collected payments will trend here." />
            )}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="Marketing" description="Spend vs attributed revenue" />
            <div className="px-4 pb-2 text-xs">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-zinc-500">Campaign spend</span>
                <span className="font-medium">{fmtMoney(data.kpis.campaignCostMinor as number, symbol)}</span>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-zinc-500">Conversions</span>
                <span className="font-medium">{fmtNumber(data.kpis.campaignConversions as number)}</span>
              </div>
            </div>
            {data.campaignByMonth.length > 0 ? (
              <div className="p-4 pt-0">
                <CampaignBars data={data.campaignByMonth} symbol={symbol} />
              </div>
            ) : (
              <EmptyState title="No campaign data" hint="Add campaign metrics to see ROAS." />
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="SEO" description="Keyword positions" />
          <div className="space-y-2 p-4 text-sm">
            <Row label="Tracked keywords" value={fmtNumber(seo.keywords ?? 0)} />
            <Row label="Top 10" value={fmtNumber(seo.top10 ?? 0)} />
            <Row label="Avg position" value={seo.avgPosition ? String(seo.avgPosition) : "—"} />
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">This week</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-0.5 text-emerald-500">
                  <ArrowUpRight className="h-3 w-3" /> {seo.improved ?? 0} improved
                </span>
                <span className="flex items-center gap-0.5 text-red-500">
                  <ArrowDownRight className="h-3 w-3" /> {seo.declined ?? 0} down
                </span>
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Team hours" description="Billable time (12 mo)" />
          <div className="p-4">
            {data.timeByMember.length > 0 ? (
              <TimeBars data={data.timeByMember.slice(0, 6)} />
            ) : (
              <EmptyState title="No timesheets" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent payments" />
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.recentPayments.length === 0 && <EmptyState title="No payments yet" />}
            {data.recentPayments.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.client ?? "On-account"}</p>
                  <p className="text-xs text-zinc-400">{p.invoice ?? p.number}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-emerald-600">{fmtMoney(p.amountMinor, symbol)}</p>
                  <p className="text-[10px] uppercase text-zinc-400">{p.method.replace("_", " ")}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent activity" description="Auditable trail across the workspace" />
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {data.activity.length === 0 && <EmptyState title="No activity yet" />}
          {data.activity.slice(0, 8).map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge className={statusClass(a.action.split(".")[1] ?? "DRAFT")}>{a.action}</Badge>
                <span className="text-zinc-500">{a.user}</span>
              </div>
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <Clock className="h-3 w-3" /> {fmtDateTime(a.at)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
