import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getAudit } from "@/server/services/seo.service";
import { Card, CardHeader, Badge } from "@/components/ui";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-500/15 text-red-600 border-red-500/30",
  ERROR: "bg-red-500/15 text-red-600 border-red-500/30",
  WARNING: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  NOTICE: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  PASS: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

export default async function AuditDetailPage({ params }: PageProps<"/seo/audits/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  let audit;
  try {
    audit = await getAudit(ctxOf(viewer, h.get("x-forwarded-for")), id);
  } catch {
    notFound();
  }
  const grouped = new Map<string, typeof audit.issues>();
  for (const issue of audit.issues) {
    const arr = grouped.get(issue.category) ?? [];
    arr.push(issue);
    grouped.set(issue.category, arr);
  }
  const tone = audit.score == null ? "text-zinc-400" : audit.score >= 80 ? "text-emerald-600" : audit.score >= 55 ? "text-amber-600" : "text-red-600";

  return (
    <div>
      <Link href="/seo/audits" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All audits
      </Link>
      <div className="mb-6 flex items-center gap-6">
        <div className={`flex h-20 w-20 items-center justify-center rounded-full border-4 ${tone === "text-emerald-600" ? "border-emerald-500" : tone === "text-amber-600" ? "border-amber-500" : "border-red-500"}`}>
          <span className={`text-2xl font-bold ${tone}`}>{audit.score ?? "—"}</span>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{audit.url}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {audit.passedCount} passed · {audit.issueCount} issues · {audit.project?.name ?? "organization"}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {[...grouped.entries()].map(([category, issues]) => (
          <Card key={category}>
            <CardHeader title={<span className="capitalize">{category}</span>} description={`${issues.filter((i) => i.severity !== "PASS").length} issues · ${issues.filter((i) => i.severity === "PASS").length} passed`} />
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {issues.map((i) => (
                <li key={i.id} className="flex items-start gap-3 px-5 py-3">
                  <Badge className={`shrink-0 border ${SEVERITY_STYLE[i.severity] ?? "bg-zinc-500/15 text-zinc-600"}`}>{i.severity.toLowerCase()}</Badge>
                  <div>
                    <p className="text-sm font-medium">{i.message}</p>
                    <p className="font-mono text-[11px] text-zinc-400">{i.checkCode}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
