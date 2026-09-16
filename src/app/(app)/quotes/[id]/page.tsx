import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { requirePageViewer } from "@/server/pages";
import { ctxOf } from "@/server/services/common";
import { getQuote } from "@/server/services/sales.service";
import { Card, CardHeader } from "@/components/ui";
import { fmtMoney, fmtDate } from "@/lib/format";
import { QuoteActions } from "./quote-actions";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  const h = await headers();
  let q;
  try {
    q = await getQuote(ctxOf(viewer, h.get("x-forwarded-for")), id);
  } catch {
    notFound();
  }
  const permissions = [...viewer.active!.permissions];
  const symbol = q.currency.symbol;

  return (
    <div>
      <Link href="/quotes" className="mb-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="h-3 w-3" /> All quotes
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{q.number}</h1>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium capitalize dark:bg-zinc-800">{q.status.toLowerCase()}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{q.client.name} · Issued {fmtDate(q.issueDate)} · Valid until {fmtDate(q.validUntil)}</p>
        </div>
        <QuoteActions id={q.id} status={q.status} permissions={permissions} convertedInvoiceId={q.convertedInvoiceId} />
      </div>

      <Card>
        <CardHeader title="Line items" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="px-5 py-2.5">Description</th>
                <th className="px-2 py-2.5 text-right">Qty</th>
                <th className="px-2 py-2.5 text-right">Unit</th>
                <th className="px-5 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {q.lines.map((l) => (
                <tr key={l.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className="px-5 py-3 font-medium">{l.description}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{(l.qtyHundredths / 100).toLocaleString("en-IN")}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{fmtMoney(Number(l.unitPriceMinor), symbol)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{fmtMoney(Number(l.lineTotalMinor), symbol)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span>{fmtMoney(Number(q.subtotalMinor), symbol)}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">Tax</span><span>{fmtMoney(Number(q.taxMinor), symbol)}</span></div>
            <div className="flex justify-between border-t border-zinc-100 pt-1 text-base font-semibold dark:border-zinc-800"><span>Total</span><span>{fmtMoney(Number(q.totalMinor), symbol)}</span></div>
          </div>
        </div>
      </Card>
      {q.terms && (
        <Card className="mt-4">
          <CardHeader title="Terms" />
          <p className="whitespace-pre-wrap p-4 text-sm text-zinc-600 dark:text-zinc-400">{q.terms}</p>
        </Card>
      )}
    </div>
  );
}
