import { notFound } from "next/navigation";
import { clientIp } from "@/server/audit";
import Link from "next/link";
import { headers } from "next/headers";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getProject } from "@/server/services/delivery.service";
import { Card, Badge } from "@/components/ui";
import { fmtMoney, fmtMinutes } from "@/lib/format";
import { ProjectDelivery } from "./project-delivery";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-600",
  PLANNING: "bg-violet-500/15 text-violet-600",
  ON_HOLD: "bg-amber-500/15 text-amber-600",
  COMPLETED: "bg-sky-500/15 text-sky-600",
  CANCELLED: "bg-zinc-500/15 text-zinc-600",
};

export default async function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  const ctx = ctxOf(viewer, clientIp(h));
  let data;
  try {
    data = await getProject(ctx, id);
  } catch {
    notFound();
  }
  const { project, totals, taskGroups } = data;
  const permissions = [...viewer.active!.permissions];
  const symbol = project.currency.symbol;
  const counts = Object.fromEntries(taskGroups.map((g) => [g.status, g._count]));
  const openTasks = taskGroups.filter((g) => !["DONE", "CANCELLED"].includes(g.status)).reduce((a, g) => a + g._count, 0);

  return (
    <div>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All projects
      </Link>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge className={STATUS_BADGE[project.status] ?? "bg-zinc-500/15 text-zinc-600"}>{project.status.toLowerCase()}</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          <Link href={`/clients/${project.client.id}`} className="hover:underline">{project.client.name}</Link>
          {project.type ? ` · ${project.type.name}` : ""}
          {project.domainUrl ? ` · ${project.domainUrl.replace(/^https?:\/\//, "")}` : ""}
        </p>
        {project.summary && <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{project.summary}</p>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={String(openTasks)} />
        <Stat label="Billable hours" value={fmtMinutes(totals.minutesLogged)} />
        <Stat label="Unbilled time" value={fmtMinutes(totals.unbilledMinutes)} hint="flows into invoices" />
        <Stat label="Unbilled expenses" value={fmtMoney(Number(totals.unbilledExpenseMinor), symbol)} />
      </div>

      <ProjectDelivery
        projectId={project.id}
        projectName={project.name}
        permissions={permissions}
        hourlyRate={project.hourlyRateMinor != null ? Number(project.hourlyRateMinor) / 100 / 60 : null}
        counts={counts}
        members={project.members.map((m) => ({ id: m.user.id, name: m.user.name }))}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
    </Card>
  );
}
