"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { Badge, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { Check } from "lucide-react";

type Plan = {
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  interval: string;
  trialDays: number;
  maxSeats: number;
  maxClients: number;
  maxProjects: number;
  maxKeywords: number;
  symbol: string;
  features: string[];
};

const FEATURE_LABELS: Record<string, string> = {
  RANK_TRACKING: "Rank tracking",
  SITE_AUDIT: "Site audits",
  BACKLINK_INDEX: "Backlink index",
  CAMPAIGN_METRICS: "Campaign metrics",
  TIME_TRACKING: "Time tracking",
  EXPENSE_TRACKING: "Expense tracking",
  QUOTES: "Quotes",
  INVOICING: "Invoicing",
  ONLINE_COLLECT: "Online collection",
  REPORT_BUILDER: "Report builder",
  API_ACCESS: "API access",
  WHITE_LABEL: "White label",
};

const LIMIT_LABELS: Record<keyof Pick<Plan, "maxSeats" | "maxClients" | "maxProjects" | "maxKeywords">, string> = {
  maxSeats: "team seats",
  maxClients: "clients",
  maxProjects: "projects",
  maxKeywords: "tracked keywords",
};

export function WelcomeClient({ orgName, plans }: { orgName: string; plans: Plan[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(code: string) {
    setBusy(code);
    try {
      await api.post("/billing/subscribe", { planCode: code });
      toast("success", "Workspace ready — welcome to OmniMark!");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not start subscription");
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="text-sm font-medium text-violet-600">Welcome to OmniMark</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Choose a plan for {orgName}</h1>
          <p className="mt-2 text-sm text-zinc-500">Start with a {plans[0]?.trialDays ?? 14}-day free trial. No card charged today.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <div
              key={p.code}
              className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <p className="mt-1 min-h-10 text-xs text-zinc-500">{p.description}</p>
              <div className="mt-3">
                <span className="text-2xl font-semibold">{fmtMoney(p.priceMinor, p.symbol)}</span>
                <span className="text-xs text-zinc-400"> / {p.interval.toLowerCase()}</span>
              </div>
              <ul className="mt-4 flex-1 space-y-1.5">
                {(["maxSeats", "maxClients", "maxProjects", "maxKeywords"] as const).map((k) =>
                  p[k] > 0 ? (
                    <li key={k} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <Check className="h-3 w-3 text-emerald-500" />
                      {p[k]} {LIMIT_LABELS[k]}
                    </li>
                  ) : (
                    <li key={k} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      <Check className="h-3 w-3 text-emerald-500" />
                      Unlimited {LIMIT_LABELS[k]}
                    </li>
                  ),
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1">
                {p.features.slice(0, 6).map((f) => (
                  <Badge key={f} className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {FEATURE_LABELS[f] ?? f}
                  </Badge>
                ))}
              </div>
              <Button className="mt-5 w-full" loading={busy === p.code} onClick={() => choose(p.code)}>
                {busy === p.code ? "Starting…" : "Start trial"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
