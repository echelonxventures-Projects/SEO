import { db } from "@/server/db";
import { verifyToken } from "@/server/tokens";
import { PayClient } from "./pay-client";

export const metadata = { title: "Secure payment" };
export const dynamic = "force-dynamic";

type Resolved =
  | { ok: false }
  | {
      ok: true;
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
    };

async function resolveCheckout(rawToken: string, status: string | string[] | undefined): Promise<Resolved> {
  try {
    const token = decodeURIComponent(rawToken);
    const decoded = verifyToken("invoice_checkout", token);
    const invoice = await db.invoice.findUnique({
      where: { id: decoded.s },
      include: {
        org: { select: { name: true } },
        client: { select: { name: true } },
      },
    });
    if (!invoice || invoice.checkoutToken !== token) return { ok: false };
    const paid = Number(invoice.paidMinor);
    const total = Number(invoice.totalMinor);
    return {
      ok: true,
      token,
      orgName: invoice.org.name,
      number: invoice.number,
      clientName: invoice.client?.name ?? null,
      currencyCode: invoice.currencyCode,
      totalMinor: total,
      outstandingMinor: total - paid,
      status: invoice.status,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      cancelled: status === "cancelled",
    };
  } catch {
    return { ok: false };
  }
}

export default async function PayPage({ params, searchParams }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const resolved = await resolveCheckout(token, query?.status);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        {!resolved.ok ? (
          <Message title="Invalid link" body="This payment link is not valid or has expired." />
        ) : (
          <PayClient
            token={resolved.token}
            orgName={resolved.orgName}
            number={resolved.number}
            clientName={resolved.clientName}
            currencyCode={resolved.currencyCode}
            totalMinor={resolved.totalMinor}
            outstandingMinor={resolved.outstandingMinor}
            status={resolved.status}
            dueDate={resolved.dueDate}
            cancelled={resolved.cancelled}
          />
        )}
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-semibold text-red-600">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500">{body}</p>
    </div>
  );
}
