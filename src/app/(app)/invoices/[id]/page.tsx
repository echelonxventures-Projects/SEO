import { notFound } from "next/navigation";
import { clientIp } from "@/server/audit";
import Link from "next/link";
import { headers } from "next/headers";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getInvoice } from "@/server/services/sales.service";
import { Card, CardHeader } from "@/components/ui";
import { fmtMoney, fmtDate } from "@/lib/format";
import { InvoiceActions } from "./invoice-actions";
import { ArrowLeft, Printer } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  let inv;
  try {
    inv = await getInvoice(ctxOf(viewer, clientIp(h)), id);
  } catch {
    notFound();
  }
  const permissions = [...viewer.active!.permissions];
  const symbol = inv.currency.symbol;
  const outstanding = Number(inv.totalMinor) - Number(inv.paidMinor);
  const breakdown = (inv.taxBreakdown as Array<{ name: string; bps: number; baseMinor: number; taxMinor: number }> | null) ?? [];

  return (
    <div>
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All invoices
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{inv.number}</h1>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium capitalize dark:bg-zinc-800">{inv.status.replace("_", " ").toLowerCase()}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {inv.client?.name ?? "—"} · Issued {fmtDate(inv.issueDate)} · Due {fmtDate(inv.dueDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/print/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Printer className="h-4 w-4" /> Print
          </a>
          <InvoiceActions id={inv.id} status={inv.status} permissions={permissions} outstanding={outstanding} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Line items" description={`${inv.lines.length} items`} />
          <TWrapish>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-5 py-2.5">Description</th>
                  <th className="px-2 py-2.5 text-right">Qty</th>
                  <th className="px-2 py-2.5 text-right">Unit</th>
                  <th className="px-2 py-2.5 text-right">Disc</th>
                  <th className="px-2 py-2.5 text-right">Tax</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="px-5 py-3">
                      <p className="font-medium">{l.description}</p>
                      {l.serviceItem && <p className="text-xs text-zinc-400">{l.serviceItem.code}</p>}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{(l.qtyHundredths / 100).toLocaleString("en-IN")}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{fmtMoney(Number(l.unitPriceMinor), symbol)}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{l.discountBps ? `${l.discountBps / 100}%` : "—"}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{l.taxBps ? `${l.taxBps / 100}%` : "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{fmtMoney(Number(l.lineTotalMinor), symbol)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TWrapish>
          <div className="space-y-1.5 border-t border-zinc-100 px-5 py-4 text-sm dark:border-zinc-800">
            <Row k="Subtotal" v={fmtMoney(Number(inv.subtotalMinor), symbol)} />
            {breakdown.map((b) => (
              <Row key={b.name} k={`${b.name} (${b.bps / 100}%)`} v={fmtMoney(b.taxMinor, symbol)} />
            ))}
            {Number(inv.discountMinor) > 0 && <Row k="Discount" v={`−${fmtMoney(Number(inv.discountMinor), symbol)}`} />}
            <div className="mt-2 flex justify-between border-t border-zinc-100 pt-2 text-base font-semibold dark:border-zinc-800">
              <span>Total</span>
              <span>{fmtMoney(Number(inv.totalMinor), symbol)}</span>
            </div>
            <Row k="Paid" v={fmtMoney(Number(inv.paidMinor), symbol)} />
            <Row k="Outstanding" v={<span className={outstanding > 0 ? "text-red-600" : "text-emerald-600"}>{fmtMoney(outstanding, symbol)}</span>} />
          </div>
        </Card>

        <div className="space-y-4">
          {inv.client && (
            <Card>
              <CardHeader title="Billed to" />
              <div className="p-4 text-sm">
                <p className="font-medium">{inv.client.name}</p>
                {inv.client.legalName && <p className="text-zinc-500">{inv.client.legalName}</p>}
                {inv.client.billingEmail && <p className="text-zinc-500">{inv.client.billingEmail}</p>}
                {inv.client.gstin && <p className="mt-1 text-xs text-zinc-400">GSTIN {inv.client.gstin}</p>}
                <p className="mt-1 text-xs text-zinc-400">{[inv.client.addressLine1, inv.client.city, inv.client.state].filter(Boolean).join(", ")}</p>
              </div>
            </Card>
          )}
          {inv.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments" />
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inv.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{fmtMoney(Number(p.amountMinor), symbol)}</p>
                      <p className="text-xs text-zinc-400">{fmtDate(p.paidAt)} · {p.method.replace("_", " ")}</p>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400">{p.reference ?? p.number}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {inv.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap p-4 text-sm text-zinc-600 dark:text-zinc-400">{inv.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TWrapish({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
