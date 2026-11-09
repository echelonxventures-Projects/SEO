import { requirePageViewer } from "@/server/pages";
import { clientIp } from "@/server/audit";
import { ctxOf } from "@/server/services/common";
import { getBillingState } from "@/server/services/billing.service";
import { headers } from "next/headers";
import { BillingClient } from "./billing-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const viewer = await requirePageViewer();
  const ctx = ctxOf(viewer, clientIp(await headers()));
  const state = await getBillingState(ctx);
  const permissions = [...viewer.active!.permissions];

  if (!state.subscription) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold">No subscription yet</h1>
        <p className="mt-2 text-sm text-zinc-500">Choose a plan to start using OmniMark.</p>
        <a href="/welcome" className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900">Pick a plan</a>
      </div>
    );
  }

  const sub = state.subscription;
  return (
    <BillingClient
      permissions={permissions}
      plan={{ name: sub.plan.name, code: sub.plan.code, priceMinor: Number(sub.plan.priceMinor), interval: sub.plan.interval, symbol: sub.plan.currency.symbol, maxSeats: sub.plan.maxSeats }}
      subscription={{
        status: sub.status,
        seats: sub.seats,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }}
      usage={state.usage}
      limits={{ maxSeats: sub.plan.maxSeats, maxClients: sub.plan.maxClients, maxProjects: sub.plan.maxProjects, maxKeywords: sub.plan.maxKeywords }}
      invoices={sub.invoices.map((i) => ({
        id: i.id, number: i.number, status: i.status,
        totalMinor: Number(i.totalMinor), paidMinor: Number(i.paidMinor),
        issueDate: i.issueDate.toISOString(), dueDate: i.dueDate?.toISOString() ?? null,
        currencyCode: i.currencyCode,
      }))}
    />
  );
}
