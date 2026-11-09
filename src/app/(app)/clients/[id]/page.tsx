import { notFound } from "next/navigation";
import { clientIp } from "@/server/audit";
import Link from "next/link";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getClient } from "@/server/services/crm.service";
import { headers } from "next/headers";
import { Card, CardHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { ClientDetailClient } from "./client-client";
import { ClientOps } from "./client-ops";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  let data;
  try {
    data = await getClient(ctxOf(viewer, clientIp(h)), id);
  } catch {
    notFound();
  }
  const { client, projects, stats } = data;
  const contacts = client.contacts ?? [];
  const symbol = client.currency?.symbol ?? "₹";
  const permissions = [...viewer.active!.permissions];
  const billed = Number(stats.billedMinor);
  const collected = Number(stats.collectedMinor);

  return (
    <div>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All clients
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {client.industry?.name ?? "Client"}
            {client.city ? ` · ${client.city}` : ""}
            {client.website ? (
              <>
                {" · "}
                <a className="text-sky-600 hover:underline" href={client.website} target="_blank" rel="noopener noreferrer">
                  {client.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          {permissions.includes("project.write") && (
            <Link href={`/projects?clientId=${client.id}`}>
              <span className="inline-flex items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                View projects
              </span>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Stat label="Billed" value={fmtMoney(billed, symbol)} />
        <Stat label="Collected" value={fmtMoney(collected, symbol)} />
        <Stat label="Outstanding" value={fmtMoney(billed - collected, symbol)} />
        <Stat label="Quotes" value={String(stats.quoteCount)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Projects" description={`${projects.length} total`} />
          <ClientDetailClient projects={projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            updatedAt: p.updatedAt.toISOString(),
          }))} client={client.name} clientId={client.id} permissions={permissions} />
        </Card>

        <div className="space-y-4">
          <ClientOps clientId={client.id} initial={(client as { customFields?: Record<string, unknown> }).customFields ?? {}} permissions={permissions} />
          <Card>
            <CardHeader title="Billing profile" />
            <div className="space-y-2 p-4 text-sm">
              <Line k="Email" v={client.billingEmail ?? "—"} />
              <Line k="GSTIN" v={client.gstin ?? "—"} />
              <Line k="Currency" v={client.currency?.code ?? "—"} />
              <Line k="Terms" v={`${client.paymentTermsDays} days`} />
              <Line k="State" v={client.state ?? "—"} />
              <Line k="Tax exempt" v={client.taxExempt ? "Yes" : "No"} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Contacts" />
            <div className="p-2">
              {contacts.length === 0 && <p className="p-3 text-sm text-zinc-400">No contacts yet.</p>}
              {contacts.map((c) => (
                <div key={c.id} className="rounded-lg px-3 py-2 text-sm">
                  <p className="font-medium">
                    {c.name} {c.isPrimary && <span className="text-[10px] uppercase text-zinc-400">primary</span>}
                  </p>
                  <p className="text-xs text-zinc-500">{[c.email, c.phone].filter(Boolean).join(" · ") || c.designation || ""}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
