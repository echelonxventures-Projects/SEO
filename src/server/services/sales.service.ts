import { z } from "zod";
import { db } from "../db";
import { getEnv } from "../env";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, dateSchema, enumFilter, longText, moneySchema, nameish, paginationSchema, skipTake } from "../schemas";
import { computeDocument, computeLine, minorToNumber, toMinor, type DocTotals, type TaxComponent } from "../money";
import { nextDocumentNumber } from "../numbering";
import { recomputeInvoiceStatus, settleInvoicePayment } from "./ledger";
import type { Invoice, Prisma } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertFeature, assertWritable, audit, requireOwned } from "./common";
import { resolveTax } from "./settings.service";

// ---------------------------------------------------------------------------
// Shared document-line machinery
// ---------------------------------------------------------------------------

export const documentLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  serviceItemId: z.string().max(64).nullable().optional(),
  qty: z.number().positive().max(1_000_000),
  unitPrice: moneySchema,
  discountBps: bpsSchema.default(0),
  taxRateId: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const documentSchema = z.object({
  clientId: z.string().min(1),
  offerCode: z.string().trim().max(20).nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  issueDate: dateSchema.optional(),
  validUntil: dateSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  discount: moneySchema.default(0),
  notes: longText.nullable().optional(),
  terms: longText.nullable().optional(),
  lines: z.array(documentLineSchema).min(1).max(100),
});

type PricedLine = {
  description: string;
  serviceItemId: string | null;
  qtyHundredths: number;
  unitPriceMinor: bigint;
  discountBps: number;
  taxRateId: string | null;
  taxBps: number;
  components: TaxComponent[];
  sortOrder: number;
};

async function priceLines(
  tx: Prisma.TransactionClient,
  org: { id: string; state: string | null; country: string },
  client: { id: string; state: string | null; country: string; taxExempt: boolean },
  lines: z.infer<typeof documentLineSchema>[],
  documentDiscountMinor: bigint,
): Promise<{ priced: PricedLine[]; totals: DocTotals; lineInputs: ReturnType<typeof computeLine>[] }> {
  const priced: PricedLine[] = [];
  for (const l of lines) {
    if (l.serviceItemId) {
      await requireOwned(await tx.serviceItem.findUnique({ where: { id: l.serviceItemId } }), "Service item", org.id);
    }
    const serviceTaxId = l.taxRateId ?? null;
    const tax = await resolveTax(tx, org, client, serviceTaxId);
    priced.push({
      description: l.description,
      serviceItemId: l.serviceItemId ?? null,
      qtyHundredths: Math.round(l.qty * 100),
      unitPriceMinor: toMinor(l.unitPrice),
      discountBps: l.discountBps,
      taxRateId: serviceTaxId,
      taxBps: tax.bps,
      components: tax.components,
      sortOrder: l.sortOrder ?? priced.length,
    });
  }
  const lineInputs = priced.map((p) =>
    computeLine({
      unitPriceMinor: p.unitPriceMinor,
      qtyHundredths: p.qtyHundredths,
      discountBps: p.discountBps,
      taxBps: p.taxBps,
    }),
  );
  const totals = computeDocument(
    priced.map((p, i) => ({ line: lineInputs[i], taxBps: p.taxBps, components: p.components })),
    documentDiscountMinor,
  );
  return { priced, totals, lineInputs };
}

function clientTaxProfile(client: { id: string; state: string | null; country: string; taxExempt: boolean }) {
  return client;
}

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

export const serviceItemSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_.:/#-]{1,32}$/),
  name: nameish,
  description: longText.nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  unit: z.enum(["HOUR", "PIECE", "MONTH", "PROJECT", "RETAINER"]),
  price: moneySchema,
  taxable: z.boolean().optional(),
  taxRateId: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
});

export async function listServiceItems(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const where = {
    orgId: ctx.orgId,
    ...(query.get("active") === "1" ? { active: true } : {}),
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.serviceItem.findMany({
      where,
      ...skipTake(p),
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      include: { category: true, taxRate: true, currency: true },
    }),
    db.serviceItem.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function createServiceItem(ctx: Ctx, input: unknown) {
  const data = serviceItemSchema.parse(input);
  await assertWritable(ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const item = await db.serviceItem
    .create({
      data: {
        orgId: ctx.orgId,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        categoryId: data.categoryId ?? null,
        unit: data.unit,
        priceMinor: toMinor(data.price),
        currencyCode: org.defaultCurrencyCode,
        taxable: data.taxable ?? true,
        taxRateId: data.taxable === false ? null : data.taxRateId ?? null,
        active: data.active ?? true,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A service with this code already exists");
    });
  await audit(db, ctx, "catalog.created", undefined, item.id, { code: data.code });
  return item;
}

export async function updateServiceItem(ctx: Ctx, id: string, input: unknown) {
  const data = serviceItemSchema.partial().parse(input);
  await requireOwned(await db.serviceItem.findUnique({ where: { id } }), "Service item", ctx.orgId);
  const item = await db.serviceItem.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      categoryId: data.categoryId,
      unit: data.unit,
      priceMinor: data.price != null ? toMinor(data.price) : undefined,
      taxable: data.taxable,
      taxRateId: data.taxRateId,
      active: data.active,
    },
  });
  await audit(db, ctx, "catalog.updated", undefined, id);
  return item;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function listQuotes(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const where = {
    orgId: ctx.orgId,
    status: enumFilter(status, ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED"] as const),
    ...(p.q ? { OR: [{ number: { contains: p.q } }, { client: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.quote.findMany({
      where,
      ...skipTake(p),
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true } }, currency: true },
    }),
    db.quote.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function createQuote(ctx: Ctx, input: unknown) {
  const data = documentSchema.parse(input);
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "QUOTES");
  const client = await requireOwned(
    await db.client.findUnique({ where: { id: data.clientId } }),
    "Client",
    ctx.orgId,
  );
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const quote = await db.$transaction(async (tx) => {
    const { priced, totals, lineInputs } = await priceLines(
      tx,
      org,
      clientTaxProfile(client),
      data.lines,
      toMinor(data.discount),
    );
    const number = await nextDocumentNumber(tx, ctx.orgId, "QUOTE");
    const created = await tx.quote.create({
      data: {
        orgId: ctx.orgId,
        clientId: client.id,
        number,
        currencyCode: client.currencyCode,
        issueDate: new Date(data.issueDate ?? Date.now()),
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        discountMinor: toMinor(data.discount),
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        notes: data.notes ?? null,
        terms: data.terms ?? null,
        createdById: ctx.userId,
        lines: {
          create: priced.map((l, i) => ({
            description: l.description,
            serviceItemId: l.serviceItemId,
            qtyHundredths: l.qtyHundredths,
            unitPriceMinor: l.unitPriceMinor,
            discountBps: l.discountBps,
            taxRateId: l.taxRateId,
            taxBps: l.taxBps,
            lineTotalMinor: lineInputs[i].lineTotalMinor,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
    await audit(tx, ctx, "quote.created", "QUOTE", created.id, { number, totalMinor: minorToNumber(totals.totalMinor) });
    return created;
  });
  return quote;
}

export async function getQuote(ctx: Ctx, id: string) {
  const quote = await requireOwned(
    await db.quote.findUnique({
      where: { id },
      include: {
        client: true,
        currency: true,
        approvedBy: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        lines: { include: { taxRate: true, serviceItem: true }, orderBy: { sortOrder: "asc" } },
        convertedInvoice: { select: { id: true, number: true, status: true } },
      },
    }),
    "Quote",
    ctx.orgId,
  );
  return quote;
}

export async function sendQuote(ctx: Ctx, id: string) {
  const quote = await requireOwned(await db.quote.findUnique({ where: { id } }), "Quote", ctx.orgId);
  if (quote.status !== "DRAFT") throw new AppError(ErrorCodes.ILLEGAL_STATE, `A ${quote.status} quote cannot be sent`);
  const updated = await db.quote.update({
    where: { id },
    data: { status: "SENT", validUntil: quote.validUntil ?? new Date(Date.now() + 30 * 86400_000) },
  });
  await audit(db, ctx, "quote.sent", "QUOTE", id);
  return updated;
}

export const quoteDecisionSchema = z.object({ accept: z.boolean(), note: longText.optional() });

export async function decideQuote(ctx: Ctx, id: string, input: unknown) {
  const { accept, note } = quoteDecisionSchema.parse(input);
  const quote = await requireOwned(await db.quote.findUnique({ where: { id } }), "Quote", ctx.orgId);
  if (quote.status !== "SENT" && quote.status !== "VIEWED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Only SENT quotes can be ${accept ? "accepted" : "declined"}`);
  }
  const updated = await db.quote.update({
    where: { id },
    data: {
      status: accept ? "ACCEPTED" : "DECLINED",
      approvedById: accept ? ctx.userId : null,
      approvedAt: accept ? new Date() : null,
      notes: note ? `${quote.notes ?? ""}\n${note}`.trim() : quote.notes,
    },
  });
  await audit(db, ctx, accept ? "quote.accepted" : "quote.declined", "QUOTE", id);
  return updated;
}

export async function convertQuoteToInvoice(ctx: Ctx, id: string, input: unknown) {
  const { dueDate } = z.object({ dueDate: dateSchema.optional() }).parse(input ?? {});
  const quote = await requireOwned(
    await db.quote.findUnique({ where: { id }, include: { lines: true } }),
    "Quote",
    ctx.orgId,
  );
  if (quote.status !== "ACCEPTED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only accepted quotes can be converted");
  }
  if (quote.convertedInvoiceId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Quote already converted");
  }
  const client = await db.client.findUniqueOrThrow({ where: { id: quote.clientId } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const invoice = await db.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, ctx.orgId, "INVOICE");
    const lines = await Promise.all(
      quote.lines.map(async (l) => {
        const tax = await resolveTax(tx, org, clientTaxProfile(client), l.taxRateId);
        return {
          description: l.description,
          serviceItemId: l.serviceItemId,
          sourceType: "QUOTE" as const,
          sourceQuoteLineId: l.id,
          qtyHundredths: l.qtyHundredths,
          unitPriceMinor: l.unitPriceMinor,
          discountBps: l.discountBps,
          taxRateId: l.taxRateId,
          taxBps: tax.bps,
          components: tax.components,
          sortOrder: l.sortOrder,
        };
      }),
    );
    const lineInputs = lines.map((l) =>
      computeLine({ unitPriceMinor: l.unitPriceMinor, qtyHundredths: l.qtyHundredths, discountBps: l.discountBps, taxBps: l.taxBps }),
    );
    const totals = computeDocument(
      lines.map((l, i) => ({ line: lineInputs[i], taxBps: l.taxBps, components: l.components })),
      quote.discountMinor,
    );
    const created = await tx.invoice.create({
      data: {
        orgId: ctx.orgId,
        partyKind: "CLIENT",
        clientId: client.id,
        number,
        status: "DRAFT",
        currencyCode: quote.currencyCode,
        issueDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + client.paymentTermsDays * 86400_000),
        discountMinor: quote.discountMinor,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        taxBreakdown: jsonSafeBreakdown(totals),
        terms: quote.terms,
        notes: `Converted from quote ${quote.number}`,
        quoteId: quote.id,
        createdByUserId: ctx.userId,
        lines: {
          create: lines.map((l, i) => ({
            description: l.description,
            serviceItemId: l.serviceItemId,
            sourceType: l.sourceType,
            sourceQuoteLineId: l.sourceQuoteLineId,
            qtyHundredths: l.qtyHundredths,
            unitPriceMinor: l.unitPriceMinor,
            discountBps: l.discountBps,
            taxRateId: l.taxRateId,
            taxBps: l.taxBps,
            lineTotalMinor: lineInputs[i].lineTotalMinor,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
    await tx.quote.update({
      where: { id },
      data: { status: "CONVERTED", convertedInvoiceId: created.id },
    });
    await audit(tx, ctx, "quote.converted", "INVOICE", created.id, { quoteId: id, number });
    return created;
  });
  return invoice;
}

export function jsonSafeBreakdown(totals: DocTotals) {
  return totals.taxBreakdown.map((b) => ({
    code: b.code,
    name: b.name,
    bps: b.bps,
    baseMinor: minorToNumber(b.baseMinor),
    taxMinor: minorToNumber(b.taxMinor),
  }));
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export async function listInvoices(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  await refreshOverdue(ctx.orgId);
  const status = query.get("status");
  const where = {
    orgId: ctx.orgId,
    partyKind: "CLIENT" as const,
    status: enumFilter(status, ["DRAFT", "ISSUED", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const),
    ...(p.q ? { OR: [{ number: { contains: p.q } }, { client: { name: { contains: p.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      ...skipTake(p),
      orderBy: { issueDate: "desc" },
      include: { client: { select: { id: true, name: true } }, currency: true },
    }),
    db.invoice.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

/** Idempotent status maintenance: unpaid items past their due date become OVERDUE. */
export async function refreshOverdue(orgId: string): Promise<number> {
  const res = await db.invoice.updateMany({
    where: {
      orgId,
      status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID"] },
      dueDate: { lt: new Date() },
    },
    data: { status: "OVERDUE" },
  });
  return res.count;
}

export async function createInvoice(ctx: Ctx, input: unknown) {
  const data = documentSchema.extend({ dueDate: dateSchema.nullable().optional() }).parse(input);
  await assertWritable(ctx.orgId);
  await assertFeature(ctx.orgId, "INVOICING");
  const client = await requireOwned(
    await db.client.findUnique({ where: { id: data.clientId } }),
    "Client",
    ctx.orgId,
  );
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const invoice = await db.$transaction(async (tx) => {
    let docDiscount = toMinor(data.discount);
    if (data.offerCode) {
      const { redeemOfferIn } = await import("./offers.service");
      const gross = await priceLines(tx, org, clientTaxProfile(client), data.lines, 0n);
      const red = await redeemOfferIn(tx, { orgId: ctx.orgId, userId: ctx.userId }, {
        code: data.offerCode,
        subtotalMinor: gross.totals.subtotalMinor,
        email: client.billingEmail,
        clientId: client.id,
      });
      docDiscount = docDiscount + red.discountMinor;
    }
    const { priced, totals, lineInputs } = await priceLines(
      tx,
      org,
      clientTaxProfile(client),
      data.lines,
      docDiscount,
    );
    const number = await nextDocumentNumber(tx, ctx.orgId, "INVOICE");
    const created = await tx.invoice.create({
      data: {
        orgId: ctx.orgId,
        partyKind: "CLIENT",
        clientId: client.id,
        number,
        status: "DRAFT",
        currencyCode: client.currencyCode,
        issueDate: new Date(data.issueDate ?? Date.now()),
        dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + client.paymentTermsDays * 86400_000),
        discountMinor: docDiscount,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        taxBreakdown: jsonSafeBreakdown(totals),
        notes: data.notes ?? null,
        terms: data.terms ?? null,
        createdByUserId: ctx.userId,
        lines: {
          create: priced.map((l, i) => ({
            description: l.description,
            serviceItemId: l.serviceItemId,
            qtyHundredths: l.qtyHundredths,
            unitPriceMinor: l.unitPriceMinor,
            discountBps: l.discountBps,
            taxRateId: l.taxRateId,
            taxBps: l.taxBps,
            lineTotalMinor: lineInputs[i].lineTotalMinor,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
    if (data.offerCode) {
      await tx.offerRedemption.updateMany({
        where: { orgId: ctx.orgId, invoiceId: null, offer: { code: data.offerCode.toUpperCase() }, at: { gte: new Date(Date.now() - 60_000) } },
        data: { invoiceId: created.id },
      });
    }
    await audit(tx, ctx, "invoice.created", "INVOICE", created.id, { number, totalMinor: minorToNumber(totals.totalMinor), offerCode: data.offerCode ?? null });
    return created;
  });
  return invoice;
}

export async function getInvoice(ctx: Ctx, id: string) {
  const invoice = await requireOwned(
    await db.invoice.findUnique({
      where: { id },
      include: {
        client: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
        currency: true,
        lines: { include: { taxRate: true, serviceItem: true }, orderBy: { sortOrder: "asc" } },
        payments: { orderBy: { paidAt: "desc" } },
        quote: { select: { id: true, number: true } },
        createdBy: { select: { id: true, name: true } },
        subscription: { select: { id: true, plan: { select: { name: true } } } },
      },
    }),
    "Invoice",
    ctx.orgId,
  );
  return invoice;
}

export async function issueInvoice(ctx: Ctx, id: string) {
  const invoice = await requireOwned(
    await db.invoice.findUnique({ where: { id }, include: { lines: true } }),
    "Invoice",
    ctx.orgId,
  );
  if (invoice.status !== "DRAFT") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only draft invoices can be issued");
  if (invoice.lines.length === 0) throw new AppError(ErrorCodes.VALIDATION, "Cannot issue an invoice without lines");
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: "ISSUED", issueDate: new Date() } });
    await audit(tx, ctx, "invoice.issued", "INVOICE", id, { number: invoice.number });
  });
}

export async function sendInvoice(ctx: Ctx, id: string) {
  const invoice = await requireOwned(
    await db.invoice.findUnique({ where: { id }, include: { client: true, org: { select: { name: true } } } }),
    "Invoice",
    ctx.orgId,
  );
  if (!["ISSUED", "SENT", "OVERDUE"].includes(invoice.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Issue the invoice before sending it");
  }
  if (!invoice.client) {
    throw new AppError(ErrorCodes.VALIDATION, "This invoice has no client to send to");
  }
  const to = invoice.client.billingEmail;
  if (!to) {
    throw new AppError(ErrorCodes.VALIDATION, "Client has no billing email; add one before sending");
  }
  await db.invoice.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  const { sendMail } = await import("../mail");
  await sendMail({
    to,
    subject: `Invoice ${invoice.number} from ${invoice.org.name}`,
    text:
      `Hello ${invoice.client.name},\n\nInvoice ${invoice.number} is ready.\n` +
      `Amount due: ${minorToNumber(invoice.totalMinor) / 100} ${invoice.currencyCode}\n` +
      `Due date: ${invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "n/a"}\n` +
      `View: ${getEnv().APP_URL}/print/invoices/${invoice.id}\n\nRegards,\n${invoice.org.name}`,
  });
  await audit(db, ctx, "invoice.sent", "INVOICE", id);
}

export async function voidInvoice(ctx: Ctx, id: string, input: unknown) {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(input);
  const invoice = await requireOwned(await db.invoice.findUnique({ where: { id } }), "Invoice", ctx.orgId);
  if (["VOID", "PAID"].includes(invoice.status)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `A ${invoice.status} invoice cannot be voided`);
  }
  if (invoice.paidMinor > 0n) {
    throw new AppError(
      ErrorCodes.ILLEGAL_STATE,
      "Invoice has payments. Refund or reallocate them before voiding.",
    );
  }
  await db.invoice.update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date(), voidReason: reason },
  });
  await audit(db, ctx, "invoice.voided", "INVOICE", id, { reason });
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  const invoice = await requireOwned(await db.invoice.findUnique({ where: { id } }), "Invoice", ctx.orgId);
  if (invoice.status !== "DRAFT") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only draft invoices can be deleted");
  }
  await db.invoice.delete({ where: { id } });
  await audit(db, ctx, "invoice.deleted", "INVOICE", id);
}

/** Pull unbilled time + expenses of a project into a draft invoice as lines. */
export async function addUnbilledWorkToInvoice(ctx: Ctx, invoiceId: string, input: unknown) {
  const { projectId } = z.object({ projectId: z.string().min(1) }).parse(input);
  const invoice = await requireOwned(
    await db.invoice.findUnique({ where: { id: invoiceId }, include: { client: true } }),
    "Invoice",
    ctx.orgId,
  );
  if (invoice.status !== "DRAFT") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only draft invoices accept new lines");
  if (!invoice.client) throw new AppError(ErrorCodes.VALIDATION, "This invoice has no client");
  const clientProfile = clientTaxProfile(invoice.client);
  const project = await requireOwned(await db.project.findUnique({ where: { id: projectId } }), "Project", ctx.orgId);
  if (project.clientId !== invoice.clientId) {
    throw new AppError(ErrorCodes.VALIDATION, "Project belongs to a different client");
  }
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const defaultRate = await db.taxRate.findFirst({ where: { orgId: ctx.orgId, isDefault: true, active: true } });

  const [timeEntries, expenses, existingCount] = await Promise.all([
    db.timeEntry.findMany({
      where: { projectId, billable: true, invoiceLineId: null },
      include: { task: { select: { title: true } }, user: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    db.expense.findMany({
      where: { projectId, billable: true, invoiceLineId: null },
      orderBy: { date: "asc" },
    }),
    db.invoiceLineItem.count({ where: { invoiceId } }),
  ]);
  if (timeEntries.length === 0 && expenses.length === 0) {
    throw new AppError(ErrorCodes.NOT_FOUND, "No unbilled time or expenses for this project");
  }

  await db.$transaction(async (tx) => {
    let sort = existingCount;
    const byTaskAndDay = new Map<string, { minutes: number; description: string; entryIds: string[]; rateMinor: bigint }>();
    for (const t of timeEntries) {
      const rate = t.rateMinor ?? project.hourlyRateMinor;
      if (rate == null) {
        throw new AppError(
          ErrorCodes.VALIDATION,
          `Project ${project.name} has no hourly rate; set a per-entry override or the project rate`,
        );
      }
      const key = `${t.taskId ?? "general"}:${rate}`;
      const g = byTaskAndDay.get(key) ?? {
        minutes: 0,
        description: t.task ? `Task: ${t.task.title}` : `Time: ${t.user.name}`,
        entryIds: [] as string[],
        rateMinor: rate,
      };
      g.minutes += t.minutes;
      g.entryIds.push(t.id);
      byTaskAndDay.set(key, g);
    }
    for (const g of byTaskAndDay.values()) {
      const tax = await resolveTax(tx, org, clientProfile, defaultRate?.id ?? null);
      const qtyHundredths = Math.round((g.minutes * 100) / 60);
      const line = computeLine({
        unitPriceMinor: g.rateMinor,
        qtyHundredths,
        discountBps: 0,
        taxBps: tax.bps,
      });
      const created = await tx.invoiceLineItem.create({
        data: {
          invoiceId,
          description: `${g.description} (${(g.minutes / 60).toFixed(2)} h)`,
          qtyHundredths,
          unitPriceMinor: g.rateMinor,
          taxBps: tax.bps,
          taxRateId: defaultRate?.id ?? null,
          lineTotalMinor: line.lineTotalMinor,
          sourceType: "TIME",
          sortOrder: sort++,
        },
      });
      await tx.timeEntry.updateMany({ where: { id: { in: g.entryIds } }, data: { invoiceLineId: created.id } });
    }
    for (const e of expenses) {
      const tax = await resolveTax(tx, org, clientProfile, defaultRate?.id ?? null);
      const line = computeLine({ unitPriceMinor: e.amountMinor, qtyHundredths: 100, discountBps: 0, taxBps: tax.bps });
      const created = await tx.invoiceLineItem.create({
        data: {
          invoiceId,
          description: `Expense: ${e.description ?? "project expense"}`,
          qtyHundredths: 100,
          unitPriceMinor: e.amountMinor,
          taxBps: tax.bps,
          taxRateId: defaultRate?.id ?? null,
          lineTotalMinor: line.lineTotalMinor,
          sourceType: "EXPENSE",
          sortOrder: sort++,
        },
      });
      await tx.expense.update({ where: { id: e.id }, data: { invoiceLineId: created.id } });
    }
    // Recompute document totals from the stored lines (source of truth).
    const allLines = await tx.invoiceLineItem.findMany({ where: { invoiceId } });
    const linesAll = allLines.map((l) => ({
      line: computeLine({
        unitPriceMinor: l.unitPriceMinor,
        qtyHundredths: l.qtyHundredths,
        discountBps: l.discountBps,
        taxBps: l.taxBps,
      }),
      taxBps: l.taxBps,
      components: [] as TaxComponent[],
    }));
    const totals = computeDocument(linesAll, invoice.discountMinor);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        taxBreakdown: jsonSafeBreakdown(totals),
      },
    });
    await audit(tx, ctx, "invoice.lines_added", "INVOICE", invoiceId, {
      fromProject: project.name,
      timeLines: byTaskAndDay.size,
      expenseLines: expenses.length,
    });
  });
}

// ---------------------------------------------------------------------------
// Payments & refunds
// ---------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  invoiceId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  amount: moneySchema,
  method: z.enum(["BANK_TRANSFER", "UPI", "CARD", "NETBANKING", "WALLET", "CASH", "CHEQUE", "GATEWAY", "ADJUSTMENT"]),
  paidAt: dateSchema,
  reference: z.string().trim().max(120).nullable().optional(),
  note: longText.nullable().optional(),
});



export async function recordPayment(ctx: Ctx, input: unknown) {
  const data = recordPaymentSchema.parse(input);
  await assertWritable(ctx.orgId);
  const amountMinor = toMinor(data.amount);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const payment = await db.$transaction(async (tx) => {
    let invoice: Invoice | null = null;
    let clientId = data.clientId ?? null;
    if (data.invoiceId) {
      invoice = await requireOwned(
        await tx.invoice.findUnique({ where: { id: data.invoiceId } }),
        "Invoice",
        ctx.orgId,
      );
      if (["DRAFT", "VOID"].includes(invoice.status)) {
        throw new AppError(ErrorCodes.ILLEGAL_STATE, "Cannot record payment against a draft or void invoice");
      }
      clientId = invoice.clientId;
    }
    if (clientId) {
      await requireOwned(await tx.client.findUnique({ where: { id: clientId } }), "Client", ctx.orgId);
    }
    const created = await settleInvoicePayment(tx, {
      orgId: ctx.orgId,
      invoiceId: invoice?.id ?? null,
      clientId,
      amountMinor,
      currencyCode: invoice?.currencyCode ?? org.defaultCurrencyCode,
      method: data.method,
      paidAt: new Date(data.paidAt),
      reference: data.reference ?? null,
      note: data.note ?? null,
      recordedByUserId: ctx.userId,
    });
    await audit(tx, ctx, "payment.recorded", "INVOICE", invoice?.id, {
      paymentId: created.id,
      number: created.number,
      amountMinor: minorToNumber(amountMinor),
    });
    return created;
  });
  return payment;
}

export async function listPayments(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const invoiceId = query.get("invoiceId");
  const clientId = query.get("clientId");
  const where = {
    orgId: ctx.orgId,
    ...(invoiceId ? { invoiceId } : {}),
    ...(clientId ? { clientId } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    db.payment.findMany({
      where,
      ...skipTake(p),
      orderBy: { paidAt: "desc" },
      include: { invoice: { select: { id: true, number: true } }, client: { select: { id: true, name: true } } },
    }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amountMinor: true } }),
  ]);
  return { rows, total, amountMinor: sum._sum.amountMinor ?? 0n, page: p.page, pageSize: p.pageSize };
}

export async function deletePayment(ctx: Ctx, id: string) {
  const payment = await requireOwned(await db.payment.findUnique({ where: { id } }), "Payment", ctx.orgId);
  if (payment.gatewayPaymentRef) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Gateway-captured payments cannot be deleted; refund instead");
  }
  await db.$transaction(async (tx) => {
    if (payment.invoiceId) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { paidMinor: inv.paidMinor - payment.amountMinor },
      });
      await recomputeInvoiceStatus(tx, inv.id);
    }
    await tx.payment.delete({ where: { id } });
    await audit(tx, ctx, "payment.deleted", "INVOICE", payment.invoiceId ?? undefined, { number: payment.number });
  });
}

export const refundSchema = z.object({
  amount: moneySchema,
  reason: z.string().trim().min(3).max(500),
});

export async function refundPayment(ctx: Ctx, id: string, input: unknown) {
  const data = refundSchema.parse(input);
  const refundMinor = toMinor(data.amount);
  const payment = await requireOwned(
    await db.payment.findUnique({ where: { id }, include: { invoice: true } }),
    "Payment",
    ctx.orgId,
  );
  if (payment.status !== "COMPLETED" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Payment is ${payment.status}`);
  }
  if (refundMinor > payment.amountMinor - payment.refundedMinor) {
    throw new AppError(ErrorCodes.VALIDATION, "Refund exceeds the unrefunded amount");
  }

  // Gateway-backed payments settle the refund upstream FIRST (webhook/error decides).
  if (payment.gatewayConfigId && payment.gatewayPaymentRef) {
    const { getGatewayProvider } = await import("../gateways/registry");
    const { gatewayCredential } = await import("./billing.service");
    const gw = await db.gatewayConfig.findUniqueOrThrow({ where: { id: payment.gatewayConfigId } });
    const provider = getGatewayProvider(gw.providerCode);
    const result = await provider.refund(gw, gatewayCredential(gw), {
      paymentRef: payment.gatewayPaymentRef,
      amountMinor: refundMinor,
      currency: payment.currencyCode,
    });
    await db.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          orgId: ctx.orgId,
          paymentId: payment.id,
          amountMinor: refundMinor,
          reason: data.reason,
          gatewayRefundRef: result.refundRef,
          status: result.status === "succeeded" ? "COMPLETED" : "PENDING",
          processedAt: result.status === "succeeded" ? new Date() : null,
        },
      });
      await applyRefundToLedger(tx, payment.id, refundMinor);
      await audit(tx, ctx, "payment.refund_requested", "INVOICE", payment.invoiceId ?? undefined, {
        paymentId: payment.id,
        amountMinor: minorToNumber(refundMinor),
        viaGateway: gw.providerCode,
      });
    });
    return { status: result.status === "succeeded" ? ("COMPLETED" as const) : ("PENDING" as const) };
  }

  const created = await db.$transaction(async (tx) => {
    const r = await tx.refund.create({
      data: {
        orgId: ctx.orgId,
        paymentId: payment.id,
        amountMinor: refundMinor,
        reason: data.reason,
        status: "COMPLETED",
        processedAt: new Date(),
      },
    });
    await applyRefundToLedger(tx, payment.id, refundMinor);
    await audit(tx, ctx, "payment.refunded", "INVOICE", payment.invoiceId ?? undefined, {
      paymentId: payment.id,
      amountMinor: minorToNumber(refundMinor),
    });
    return r;
  });
  return { status: created.status };
}

async function applyRefundToLedger(tx: Prisma.TransactionClient, paymentId: string, amountMinor: bigint) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const newRefunded = payment.refundedMinor + amountMinor;
  await tx.payment.update({
    where: { id: paymentId },
    data: {
      refundedMinor: newRefunded,
      status: newRefunded >= payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
    },
  });
  if (payment.invoiceId) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
    await tx.invoice.update({
      where: { id: inv.id },
      data: { paidMinor: inv.paidMinor > amountMinor ? inv.paidMinor - amountMinor : 0n },
    });
    await recomputeInvoiceStatus(tx, inv.id);
  }
}

export async function deleteQuote(ctx: Ctx, id: string) {
  const quote = await requireOwned(await db.quote.findUnique({ where: { id } }), "Quote", ctx.orgId);
  if (quote.status !== "DRAFT") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only draft quotes can be deleted");
  }
  await db.quote.delete({ where: { id } });
  await audit(db, ctx, "quote.deleted", "QUOTE", id);
}
