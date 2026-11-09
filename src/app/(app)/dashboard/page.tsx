import { requirePageViewer } from "@/server/pages";
import { clientIp } from "@/server/audit";
import { ctxOf } from "@/server/services/common";
import { dashboardOverview } from "@/server/services/analytics.service";
import { DashboardView } from "./dashboard-view";
import { headers } from "next/headers";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await requirePageViewer();
  const h = await headers();
  const data = await dashboardOverview(ctxOf(viewer, clientIp(h)), 12);
  // Serialize BigInt-safe numbers already handled by minorToNumber in service.
  return <DashboardView data={data} roleCode={viewer.active!.roleCode} />;
}
