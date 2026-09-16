"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { RecordPaymentModal } from "./record-payment";
import { useState } from "react";
import { Banknote, CreditCard, Mail, Send, XCircle } from "lucide-react";

export function InvoiceActions({
  id,
  status,
  permissions,
  outstanding,
}: {
  id: string;
  status: string;
  permissions: string[];
  outstanding: number;
}) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: string, body?: unknown) {
    setBusy(action);
    try {
      const res = await api.post<{ payUrl?: string }>(`/invoices/${id}/${action}`, body ?? {});
      if (action === "checkout" && res?.payUrl) {
        const url = window.location.origin + res.payUrl;
        await navigator.clipboard?.writeText(url).catch(() => {});
        toast("success", "Payment link copied to clipboard");
      } else {
        toast("success", "Done");
      }
      router.refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const can = (p: string) => permissions.includes(p);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && can("invoice.issue") && (
        <Button size="sm" loading={busy === "issue"} onClick={() => act("issue")}>
          <Send className="h-3.5 w-3.5" /> Issue
        </Button>
      )}
      {status === "ISSUED" && can("invoice.issue") && (
        <Button size="sm" variant="secondary" loading={busy === "send"} onClick={() => act("send")}>
          <Mail className="h-3.5 w-3.5" /> Email client
        </Button>
      )}
      {["SENT", "ISSUED", "OVERDUE", "PARTIALLY_PAID"].includes(status) && can("invoice.collect") && outstanding > 0 && (
        <Button size="sm" variant="secondary" loading={busy === "checkout"} onClick={() => act("checkout")}>
          <CreditCard className="h-3.5 w-3.5" /> Collect online
        </Button>
      )}
      {["SENT", "ISSUED", "OVERDUE", "PARTIALLY_PAID"].includes(status) && can("payment.write") && outstanding > 0 && (
        <Button size="sm" variant="secondary" onClick={() => setPayOpen(true)}>
          <Banknote className="h-3.5 w-3.5" /> Record payment
        </Button>
      )}
      {["DRAFT", "ISSUED", "SENT", "OVERDUE"].includes(status) && can("invoice.void") && (
        <Button size="sm" variant="ghost" loading={busy === "void"} onClick={() => act("void", { reason: "Voided by user" })}>
          <XCircle className="h-3.5 w-3.5" /> Void
        </Button>
      )}
      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} invoiceId={id} outstanding={outstanding} onDone={() => router.refresh()} />
    </div>
  );
}
