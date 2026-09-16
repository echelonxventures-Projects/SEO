import { redirect } from "next/navigation";
import { requirePageViewer } from "@/server/pages";
import { db } from "@/server/db";
import { WelcomeClient } from "./welcome-client";

export const metadata = { title: "Choose a plan" };

export default async function WelcomePage() {
  const viewer = await requirePageViewer();
  if (viewer.active) {
    const hasSub = await db.subscription.findFirst({
      where: { orgId: viewer.active.orgId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    });
    if (hasSub) redirect("/dashboard");
  }
  const plans = await db.plan.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sortOrder: "asc" },
    include: { features: true, currency: { select: { symbol: true, code: true } } },
  });
  const dto = plans.map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description,
    priceMinor: Number(p.priceMinor),
    interval: p.interval,
    trialDays: p.trialDays,
    maxSeats: p.maxSeats,
    maxClients: p.maxClients,
    maxProjects: p.maxProjects,
    maxKeywords: p.maxKeywords,
    symbol: p.currency.symbol,
    features: p.features.map((f) => f.featureCode),
  }));
  if (!viewer.active) {
    return (
      <div className="mx-auto max-w-md p-10 text-center text-sm text-zinc-500">
        No active workspace. Please{" "}
        <a href="/register" className="font-medium text-zinc-800 underline dark:text-zinc-200">
          create one
        </a>
        .
      </div>
    );
  }
  return <WelcomeClient orgName={viewer.active.orgName} plans={dto} />;
}
