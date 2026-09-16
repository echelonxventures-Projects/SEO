import { requirePageViewer } from "@/server/pages";
import { db } from "@/server/db";
import { PlansClient } from "./plans-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Change plan" };

export default async function PlansPage() {
  await requirePageViewer();
  const plans = await db.plan.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sortOrder: "asc" },
    include: { features: true, currency: { select: { symbol: true } } },
  });
  return (
    <PlansClient
      plans={plans.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        priceMinor: Number(p.priceMinor),
        interval: p.interval,
        maxSeats: p.maxSeats,
        maxClients: p.maxClients,
        maxProjects: p.maxProjects,
        maxKeywords: p.maxKeywords,
        symbol: p.currency.symbol,
        features: p.features.map((f) => f.featureCode),
      }))}
    />
  );
}
