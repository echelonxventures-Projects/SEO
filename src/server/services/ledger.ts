import { AppError, ErrorCodes } from "../errors";
import type { Invoice, PaymentMethod, Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "../numbering";
import { emit } from "../events";
export type SettlementInput = {
  orgId: string;
  invoiceId: string | null;
  clientId: string | null;
  amountMinor: bigint;
  currencyCode: string;
  method: PaymentMethod;
  paidAt: Date;
  reference?: string | null;
  note?: string | null;
  gatewayConfigId?: string | null;
  gatewayPaymentRef?: string | null;
  recordedByUserId: string;
};

/**
 * The ONLY place payments enter the ledger: creates the Payment row with a
 * reserved number, applies it to the invoice and transitions invoice status.
 * Used by manual recording, gateway webhooks and sandbox settlement alike.
 */
export async function settleInvoicePayment(
  tx: Prisma.TransactionClient,
  input: SettlementInput,
) {
  if (input.invoiceId) {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (["DRAFT", "VOID"].includes(invoice.status)) {
      throw new AppError(ErrorCodes.ILLEGAL_STATE, "Cannot settle against draft or void invoices");
    }
    if (input.amountMinor > invoice.totalMinor - invoice.paidMinor) {
      throw new AppError(ErrorCodes.VALIDATION, "Payment exceeds the outstanding balance");
    }
  }
  const number = await nextDocumentNumber(tx, input.orgId, "PAYMENT");
  const payment = await tx.payment.create({
    data: {
      orgId: input.orgId,
      invoiceId: input.invoiceId,
      clientId: input.clientId,
      number,
      method: input.method,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      paidAt: input.paidAt,
      reference: input.reference ?? null,
      note: input.note ?? null,
      gatewayConfigId: input.gatewayConfigId ?? null,
      gatewayPaymentRef: input.gatewayPaymentRef ?? null,
      recordedByUserId: input.recordedByUserId,
      status: "COMPLETED",
    },
  });
  if (input.invoiceId) {
    await tx.invoice.update({
      where: { id: input.invoiceId },
      data: { paidMinor: { increment: input.amountMinor } },
    });
    await recomputeInvoiceStatus(tx, input.invoiceId);
  }
  await emit(tx, {
    type: input.invoiceId ? "payment.recorded" : "credit.received",
    aggregateType: "PAYMENT",
    aggregateId: payment.id,
    orgId: input.orgId,
    payload: { amountMinor: Number(input.amountMinor), invoiceId: input.invoiceId ?? null, method: input.method },
  });
  return payment;
}

/** Invoice status is derived from money — never set directly by callers. */
export async function recomputeInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalMinor: true, paidMinor: true, status: true, dueDate: true, orgId: true },
  });
  if (["VOID", "DRAFT"].includes(invoice.status)) return;
  let status: Invoice["status"];
  const wasPaid = invoice.status === "PAID";
  if (invoice.paidMinor >= invoice.totalMinor) status = "PAID";
  else if (invoice.paidMinor > 0n) status = "PARTIALLY_PAID";
  else if (invoice.dueDate && invoice.dueDate < new Date()) status = "OVERDUE";
  else status = invoice.status;
  await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
  if (status === "PAID" && !wasPaid) {
    await emit(tx, { type: "invoice.paid", aggregateType: "INVOICE", aggregateId: invoiceId, orgId: invoice.orgId, payload: { paidMinor: Number(invoice.paidMinor) } });
  }
}
