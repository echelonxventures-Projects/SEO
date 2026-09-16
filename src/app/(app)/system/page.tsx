import { CONSTITUTION } from "@/server/constitution";
import { Badge } from "@/components/ui";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "System & constitution" };

export default async function SystemPage() {
  const counts = {
    events: await db.domainEvent.count(),
    subscriptions: await db.eventSubscription.count(),
    offers: await db.offer.count(),
    audiences: await db.audience.count(),
    channels: await db.channel.count(),
    flights: await db.campaignFlight.count(),
  };
  const STATUS_STYLE: Record<string, string> = {
    stable: "bg-emerald-500/15 text-emerald-600", building: "bg-amber-500/15 text-amber-600", planned: "bg-zinc-500/15 text-zinc-500",
  };
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{CONSTITUTION.system}</h1>
        <p className="mt-1 text-sm text-zinc-500">{CONSTITUTION.architectureStyle} · v{CONSTITUTION.version} — “{CONSTITUTION.principle}”</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{k}: <b>{v}</b></span>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CONSTITUTION.domains.map((d) => (
          <div key={d.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{d.name}</h3>
              <Badge className={STATUS_STYLE[d.status]}>{d.status}</Badge>
            </div>
            <p className="mb-3 text-xs text-zinc-500">{d.purpose}</p>
            <Section label="Schema" items={d.blueprint.schema} />
            <Section label="Rules" items={d.blueprint.rules} />
            <Section label="Workflow" items={d.blueprint.workflows} />
            <Section label="Emits" items={d.events.emits.map((e) => e)} mono />
            <Section label="Consumes" items={d.events.consumes} mono />
            <Section label="API surface" items={d.contracts.api} mono />
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-zinc-400">Machine-readable version: <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">GET /api/v1/registry</code> — every domain ships this manifest shape (§18 blueprint).</p>
    </div>
  );
}

function Section({ label, items, mono }: { label: string; items: readonly string[]; mono?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <ul className={mono ? "space-y-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400" : "list-inside list-disc text-[11px] text-zinc-600 dark:text-zinc-400"}>
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}
