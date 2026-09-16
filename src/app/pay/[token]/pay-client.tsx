"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/components/toast";
import { ShieldCheck, Loader2 } from "lucide-react";

export function PayClient({
  token,
  orgName,
  number,
  clientName,
  currencyCode,
  totalMinor,
  outstandingMinor,
  status,
  dueDate,
  cancelled,
}: {
  token: string;
  orgName: string;
  number: string;
  clientName: string | null;
  currencyCode: string;
  totalMinor: number;
  outstandingMinor: number;
  status: string;
  dueDate: string | null;
  cancelled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(status === "PAID" || outstandingMinor <= 0);
  const symbol = currencyCode === "INR" ? "₹" : currencyCode === "USD" ? "$" : currencyCode + " ";

  if (paid) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center dark:border-emerald-900 dark:bg-zinc-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
        </div>
        <h1 className="text-lg font-semibold">
          {status === "PAID" ? "Payment received" : "Thank you!"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Invoice {number} is settled{clientName ? ` for ${clientName}` : ""}. A copy has been sent to the billing email.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{orgName}</p>
      <h1 className="mt-1 text-lg font-semibold">Invoice {number}</h1>
      {clientName && <p className="text-sm text-zinc-500">Billed to {clientName}</p>}
      <div className="my-6 border-t border-zinc-100 py-4 dark:border-zinc-800">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-zinc-400">Amount due</p>
            <p className="text-3xl font-semibold">{fmtMoney(outstandingMinor, symbol)}</p>
          </div>
          {outstandingMinor !== totalMinor && (
            <div className="text-right text-xs text-zinc-400">
              <p>Total {fmtMoney(totalMinor, symbol)}</p>
              <p>Already paid {fmtMoney(totalMinor - outstandingMinor, symbol)}</p>
            </div>
          )}
        </div>
        {dueDate && (
          <p className="mt-2 text-xs text-zinc-400">Due {new Date(dueDate).toLocaleDateString("en-IN")}</p>
        )}
      </div>
      {cancelled && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Payment was cancelled. You can try again below.
        </p>
      )}
      <Button
        className="w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(`/api/v1/public/pay/${encodeURIComponent(token)}`, { method: "POST" });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error?.message ?? "Payment failed");
            setPaid(true);
          } catch (e) {
            toast("error", e instanceof Error ? e.message : "Payment failed");
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Processing…
          </>
        ) : (
          `Pay ${fmtMoney(outstandingMinor, symbol)}`
        )}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-400">
        <ShieldCheck className="h-3 w-3" /> Sandbox checkout — no real charge
      </p>
    </div>
  );
}
