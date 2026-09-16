"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";
import { Check } from "lucide-react";

type Plan = {
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  interval: string;
  maxSeats: number;
  maxClients: number;
  maxProjects: number;
  maxKeywords: number;
  symbol: string;
  features: string[];
};

const FEATURE_LABELS: Record<string, string> = {
  RANK_TRACKING: "Rank tracking", SITE_AUDIT: "Site audits", BACKLINK_INDEX: "Backlink index",
  CAMPAIGN_METRICS: "Campaign metrics", TIME_TRACKING: "Time tracking", EXPENSE_TRACKING: "Expense tracking",
  QUOTES: "Quotes", INVOICING: "Invoicing", ONLINE_COLLECT: "Online collection", REPORT_BUILDER: "Report builder",
  API_ACCESS: "API access", WHITE_LABEL: "White label",
};

export function PlansClient({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Change plan" description="Switch anytime — the new plan starts immediately, the old one ends at its period." />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <Card key={p.code} className="flex flex-col p-5">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <p className="mt-1 min-h-10 text-xs text-zinc-500">{p.description}</p>
            <div className="mt-3">
              <span className="text-2xl font-semibold">{fmtMoney(p.priceMinor, p.symbol)}</span>
              <span className="text-xs text-zinc-400"> / {p.interval.toLowerCase()}</span>
            </div>
            <ul className="mt-4 flex-1 space-y-1.5">
              {(["maxSeats", "maxClients", "maxProjects", "maxKeywords"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                  {p[k] > 0 ? `${p[k]} ` : "Unlimited "}{k.replace("max", "").toLowerCase()}
                </li>
              ))}
              {p.features.slice(0, 8).map((f) => (
                <li key={f} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                  {FEATURE_LABELS[f] ?? f}
                </li>
              ))}
            </ul>
            <Button
              className="mt-5 w-full"
              variant="secondary"
              loading={busy === p.code}
              onClick={async () => {
                setBusy(p.code);
                try {
                  await api.post("/billing/subscribe", { planCode: p.code });
                  toast("success", `Switched to ${p.name}`);
                  router.push("/billing");
                  router.refresh();
                } catch (e) {
                  toast("error", e instanceof Error ? e.message : "Failed");
                  setBusy(null);
                }
              }}
            >
              Select {p.name}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
