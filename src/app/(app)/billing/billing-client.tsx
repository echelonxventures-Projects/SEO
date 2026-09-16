"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/crud";
import { fmtMoney, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";

type Props = {
  permissions: string[];
  plan: { name: string; code: string; priceMinor: number; interval: string; symbol: string; maxSeats: number };
  subscription: { status: string; seats: number; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; cancelAtPeriodEnd: boolean };
  usage: { seats: number; clients: number; projects: number; keywords: number };
  limits: { maxSeats: number; maxClients: number; maxProjects: number; maxKeywords: number };
  invoices: Array<{ id: string; number: string; status: string; totalMinor: number; paidMinor: number; issueDate: string; dueDate: string | null; currencyCode: string }>;
};

export function BillingClient({ permissions, plan, subscription, usage, limits, invoices }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canManage = permissions.includes("subscription.manage");
  const symbol = plan.symbol;
  const unpaid = invoices.find((i) => !["PAID", "VOID"].includes(i.status));

  return (
    <div>
      <PageHeader title="Billing" description="Your OmniMark subscription and payment history." />

      {unpaid && (
        <Card className="mb-4 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Invoice {unpaid.number} is {unpaid.status.toLowerCase().replace("_", " ")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">{fmtMoney(unpaid.totalMinor - unpaid.paidMinor, symbol)} due {unpaid.dueDate ? `by ${fmtDate(unpaid.dueDate)}` : ""}</p>
            </div>
            {canManage && (
              <Button loading={busy} onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.post<{ payUrl: string }>(`/billing/invoices/${unpaid.id}/checkout`);
                  window.location.href = r.payUrl;
                } catch (e) {
                  toast("error", e instanceof Error ? e.message : "Failed");
                  setBusy(false);
                }
              }}>
                Pay now
              </Button>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Current plan" description="Your active subscription" />
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">{plan.name}</p>
                <p className="text-xs text-zinc-500">{fmtMoney(plan.priceMinor, symbol)} / {plan.interval.toLowerCase()}</p>
              </div>
              <StatusBadge value={subscription.status} />
            </div>
            <div className="border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
              <Row k="Billing period" v={`${fmtDate(subscription.currentPeriodStart)} → ${fmtDate(subscription.currentPeriodEnd)}`} />
              {subscription.trialEndsAt && subscription.status === "TRIALING" && <Row k="Trial ends" v={fmtDate(subscription.trialEndsAt)} />}
              {subscription.cancelAtPeriodEnd && <Row k="Ends on" v={<span className="text-amber-600">{fmtDate(subscription.currentPeriodEnd)}</span>} />}
            </div>
            {canManage && (
              <div className="flex gap-2 pt-1">
                {!subscription.cancelAtPeriodEnd ? (
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!window.confirm("Cancel subscription at period end? You keep access until then.")) return;
                    try { await api.post("/billing/cancel", { immediate: false }); toast("success", "Will cancel at period end"); router.refresh(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                  }}>Cancel</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={async () => {
                    try { await api.post("/billing/resume"); toast("success", "Subscription resumed"); router.refresh(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                  }}>Resume</Button>
                )}
                <Link href="/billing/plans">
                  <Button size="sm">Change plan</Button>
                </Link>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Usage" description="Against your plan limits" />
          <div className="space-y-3 p-4">
            <Usage label="Team seats" used={usage.seats} max={limits.maxSeats} />
            <Usage label="Clients" used={usage.clients} max={limits.maxClients} />
            <Usage label="Projects" used={usage.projects} max={limits.maxProjects} />
            <Usage label="Keywords" used={usage.keywords} max={limits.maxKeywords} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment history" />
          {invoices.length === 0 ? (
            <p className="p-4 text-sm text-zinc-400">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{fmtMoney(i.totalMinor, symbol)}</p>
                    <p className="text-xs text-zinc-400">{fmtDate(i.issueDate)}</p>
                  </div>
                  <StatusBadge value={i.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  // local anchor to avoid next/link import in a client leaf; uses router-friendly href
  return <a href={href}>{children}</a>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-zinc-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const unlimited = max === 0;
  const pct = unlimited ? 8 : Math.min(100, (used / max) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-zinc-500">{label}</span>
        <span className="font-medium tabular-nums">{used}{unlimited ? "" : ` / ${max}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={cnBar(pct)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function cnBar(pct: number) {
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
  return `h-full rounded-full ${color}`;
}
