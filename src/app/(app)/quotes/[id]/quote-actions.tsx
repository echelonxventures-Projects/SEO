"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { ArrowRight, Check, Send, X } from "lucide-react";

export function QuoteActions({
  id,
  status,
  permissions,
  convertedInvoiceId,
}: {
  id: string;
  status: string;
  permissions: string[];
  convertedInvoiceId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const can = (p: string) => permissions.includes(p);

  async function act(action: string, body?: unknown) {
    setBusy(action);
    try {
      const res = await api.post<{ id: string }>(`/quotes/${id}/${action}`, body ?? {});
      if (action === "convert" && res?.id) {
        toast("success", "Converted to invoice");
        router.push(`/invoices/${res.id}`);
        return;
      }
      toast("success", "Done");
      router.refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && can("quote.write") && (
        <Button size="sm" loading={busy === "send"} onClick={() => act("send")}>
          <Send className="h-3.5 w-3.5" /> Mark sent
        </Button>
      )}
      {(status === "SENT" || status === "VIEWED") && can("quote.approve") && (
        <>
          <Button size="sm" loading={busy === "accept"} onClick={() => act("decision", { accept: true })}>
            <Check className="h-3.5 w-3.5" /> Accept
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "decline"} onClick={() => act("decision", { accept: false })}>
            <X className="h-3.5 w-3.5" /> Decline
          </Button>
        </>
      )}
      {status === "ACCEPTED" && can("quote.convert") && (
        <Button size="sm" loading={busy === "convert"} onClick={() => act("convert")}>
          <ArrowRight className="h-3.5 w-3.5" /> Convert to invoice
        </Button>
      )}
      {convertedInvoiceId && (
        <Link href={`/invoices/${convertedInvoiceId}`}>
          <Button size="sm" variant="secondary">View invoice</Button>
        </Link>
      )}
    </div>
  );
}
