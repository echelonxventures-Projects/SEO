import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { emailSchema, enumFilter, longText, moneySchema, nameish, paginationSchema, phoneish, urlish } from "../schemas";
import { skipTake } from "../schemas";
import type { Ctx } from "./common";
import { assertCapacity, assertWritable, audit, requireOwned } from "./common";
import { entityIdsForTag } from "./tags.service";

export const clientSchema = z.object({
  name: nameish,
  legalName: z.string().trim().max(160).nullable().optional(),
  industryId: z.string().max(64).nullable().optional(),
  website: urlish.nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  taxExempt: z.boolean().optional(),
  phone: phoneish.nullable().optional(),
  billingEmail: emailSchema.nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(25).default([]),
  customFields: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).default({}),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(16).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
});

const CLIENT_STATUSES = ["PROSPECT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;

export async function listClients(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const tagId = query.get("tag");
  const where = {
    orgId: ctx.orgId,
    status: enumFilter(status, CLIENT_STATUSES),
    ...(tagId ? { id: { in: await entityIdsForTag(ctx.orgId, tagId, "CLIENT") } } : {}),
    ...(p.q
      ? { name: { contains: p.q, mode: "insensitive" as const } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      ...skipTake(p),
      orderBy: { updatedAt: "desc" },
      include: { industry: true, currency: true, owner: { select: { id: true, name: true } } },
    }),
    db.client.count({ where }),
  ]);
  const tags = rows.length
    ? await db.resourceTag.findMany({
        where: { orgId: ctx.orgId, entityType: "CLIENT", entityId: { in: rows.map((r) => r.id) } },
        include: { tag: { select: { id: true, name: true, color: true } } },
      })
    : [];
  const byId = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const t of tags) {
    const arr = byId.get(t.entityId) ?? [];
    arr.push(t.tag);
    byId.set(t.entityId, arr);
  }
  return {
    rows: rows.map((r) => ({ ...r, tags: byId.get(r.id) ?? [] })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export async function createClient(ctx: Ctx, input: unknown) {
  const data = clientSchema.parse(input);
  await assertWritable(ctx.orgId);
  const count = await db.client.count({ where: { orgId: ctx.orgId, status: { not: "ARCHIVED" } } });
  await assertCapacity(ctx.orgId, "CLIENTS", count + 1);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const { validateCustomFields } = await import("./customfields.service");
  data.customFields = (await validateCustomFields(ctx.orgId, "CLIENT", data.customFields)) as Record<string, string | number | boolean>;
  const { tags: tagNames, customFields, ...core } = data;
  const client = await db.client
    .create({
      data: {
        ...core,
        customFields: (customFields ?? {}) as object,
        orgId: ctx.orgId,
        currencyCode: org.defaultCurrencyCode,
        ownerId: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A client with this name already exists");
    });
  if (tagNames.length) {
    const { resolveTags, attachTags } = await import("./tags.service");
    const resolved = await resolveTags(ctx, tagNames);
    await attachTags(ctx, "CLIENT", client.id, resolved.map((t) => t.id));
  }
  await instantiateOnboarding(ctx.orgId, client.id);
  await audit(db, ctx, "client.created", "CLIENT", client.id, { name: client.name });
  return client;
}

export async function getClient(ctx: Ctx, id: string) {
  const client = await requireOwned(
    await db.client.findUnique({
      where: { id },
      include: {
        industry: true,
        currency: true,
        owner: { select: { id: true, name: true, email: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      },
    }),
    "Client",
    ctx.orgId,
  );
  const [projects, invoices, quotes] = await Promise.all([
    db.project.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
      include: { currency: true },
    }),
    db.invoice.aggregate({
      where: { clientId: id, partyKind: "CLIENT" },
      _sum: { totalMinor: true, paidMinor: true },
      _count: true,
    }),
    db.quote.aggregate({ where: { clientId: id }, _count: true }),
  ]);
  return {
    client,
    projects,
    stats: {
      invoiceCount: invoices._count,
      billedMinor: invoices._sum.totalMinor ?? 0n,
      collectedMinor: invoices._sum.paidMinor ?? 0n,
      quoteCount: quotes._count,
    },
  };
}

export async function updateClient(ctx: Ctx, id: string, input: unknown) {
  const { tags: tagNames, customFields, ...fields } = clientSchema.partial().extend({ status: z.enum(CLIENT_STATUSES).optional() }).parse(input);
  await requireOwned(await db.client.findUnique({ where: { id } }), "Client", ctx.orgId);
  let validated: Record<string, unknown> | undefined;
  if (customFields !== undefined) {
    const { validateCustomFields } = await import("./customfields.service");
    validated = await validateCustomFields(ctx.orgId, "CLIENT", customFields);
  }
  const client = await db.client.update({ where: { id }, data: { ...fields, ...(validated ? { customFields: validated as object } : {}) } });
  if (tagNames) {
    const { resolveTags, attachTags } = await import("./tags.service");
    const tags = await resolveTags(ctx, tagNames);
    await attachTags(ctx, "CLIENT", id, tags.map((t) => t.id));
  }
  await audit(db, ctx, "client.updated", "CLIENT", id, { fields: [...Object.keys(fields), ...(tagNames ? ["tags"] : [])] });
  return client;
}

export async function deleteClient(ctx: Ctx, id: string) {
  const client = await requireOwned(
    await db.client.findUnique({ where: { id }, include: { _count: { select: { projects: true, invoices: true, quotes: true } } } }),
    "Client",
    ctx.orgId,
  );
  if (client._count.projects + client._count.invoices + client._count.quotes > 0) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      "Client has projects, quotes or invoices. Archive it instead to preserve the financial trail.",
    );
  }
  await db.client.delete({ where: { id } });
  await audit(db, ctx, "client.deleted", "CLIENT", id);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contactSchema = z.object({
  name: nameish,
  email: emailSchema.nullable().optional(),
  phone: phoneish.nullable().optional(),
  designation: z.string().trim().max(80).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

async function requireContact(orgId: string, id: string) {
  const contact = await db.contact.findUnique({ where: { id }, include: { client: { select: { orgId: true } } } });
  if (!contact || contact.client.orgId !== orgId) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Contact not found");
  }
  return contact;
}

export async function createContact(ctx: Ctx, clientId: string, input: unknown) {
  const data = contactSchema.parse(input);
  await requireOwned(await db.client.findUnique({ where: { id: clientId } }), "Client", ctx.orgId);
  if (data.isPrimary) {
    await db.contact.updateMany({ where: { clientId }, data: { isPrimary: false } });
  }
  const contact = await db.contact.create({ data: { clientId, ...data } });
  await audit(db, ctx, "contact.created", "CLIENT", clientId, { contactId: contact.id });
  return contact;
}

export async function updateContact(ctx: Ctx, id: string, input: unknown) {
  const data = contactSchema.partial().parse(input);
  const contact = await requireContact(ctx.orgId, id);
  if (data.isPrimary) {
    await db.contact.updateMany({ where: { clientId: contact.clientId }, data: { isPrimary: false } });
  }
  return db.contact.update({ where: { id }, data });
}

export async function deleteContact(ctx: Ctx, id: string) {
  const contact = await requireContact(ctx.orgId, id);
  await db.contact.delete({ where: { id } });
  await audit(db, ctx, "contact.deleted", "CLIENT", contact.clientId, { contactId: id });
}

// ---------------------------------------------------------------------------
// Notes (polymorphic)
// ---------------------------------------------------------------------------

export const noteEntityTypeSchema = z.enum([
  "CLIENT",
  "LEAD",
  "PROJECT",
  "TASK",
  "INVOICE",
  "QUOTE",
  "CAMPAIGN",
  "SUBSCRIPTION",
]);

export async function createNote(ctx: Ctx, entityType: z.infer<typeof noteEntityTypeSchema>, entityId: string, input: unknown) {
  const body = z.object({ body: longText.min(1) }).parse(input).body;
  await db.note.create({
    data: {
      orgId: ctx.orgId,
      entityType,
      entityId,
      authorId: ctx.userId,
      body,
    },
  });
  await audit(db, ctx, "note.created", entityType, entityId);
}

export async function listNotes(ctx: Ctx, entityType: z.infer<typeof noteEntityTypeSchema>, entityId: string) {
  return db.note.findMany({
    where: { orgId: ctx.orgId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { id: true, name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const leadSchema = z.object({
  name: nameish,
  company: z.string().trim().max(160).nullable().optional(),
  email: emailSchema.nullable().optional(),
  phone: phoneish.nullable().optional(),
  website: urlish.nullable().optional(),
  sourceId: z.string().max(64).nullable().optional(),
  stageId: z.string().max(64).optional(),
  budget: moneySchema.nullable().optional(),
  message: longText.nullable().optional(),
});

export async function listLeads(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const where = {
    orgId: ctx.orgId,
    convertedClientId: null,
    ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" as const } }, { company: { contains: p.q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      ...skipTake(p),
      orderBy: { createdAt: "desc" },
      include: { stage: true, source: true, currency: true },
    }),
    db.lead.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function createLead(ctx: Ctx, input: unknown) {
  const data = leadSchema.parse(input);
  await assertWritable(ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const defaultStage =
    (data.stageId
      ? await db.pipelineStage.findFirst({ where: { id: data.stageId, orgId: ctx.orgId } })
      : await db.pipelineStage.findFirst({ where: { orgId: ctx.orgId, isTerminalWon: false, isTerminalLost: false }, orderBy: { sortOrder: "asc" } }))!;
  if (!defaultStage) throw new AppError(ErrorCodes.INTERNAL, "Pipeline not configured for this workspace");
  const lead = await db.lead.create({
    data: {
      orgId: ctx.orgId,
      name: data.name,
      company: data.company ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      website: data.website ?? null,
      sourceId: data.sourceId ?? null,
      stageId: defaultStage.id,
      budgetMinor: data.budget != null ? BigInt(Math.round(data.budget * 100)) : null,
      currencyCode: org.defaultCurrencyCode,
      message: data.message ?? null,
    },
  });
  await audit(db, ctx, "lead.created", "LEAD", lead.id, { name: lead.name });
  return lead;
}

export async function moveLead(ctx: Ctx, id: string, input: unknown) {
  const { stageId } = z.object({ stageId: z.string().min(1) }).parse(input);
  const lead = await requireOwned(await db.lead.findUnique({ where: { id } }), "Lead", ctx.orgId);
  const stage = await requireOwned(
    await db.pipelineStage.findUnique({ where: { id: stageId } }),
    "Pipeline stage",
    ctx.orgId,
  );
  const updated = await db.lead.update({
    where: { id },
    data: { stageId: stage.id, stageChangedAt: new Date(), lostReason: stage.isTerminalLost ? "Moved to lost" : lead.lostReason },
  });
  await audit(db, ctx, "lead.stage_changed", "LEAD", id, { stage: stage.code });
  return updated;
}

export const leadConvertSchema = z.object({
  clientName: z.string().trim().min(2).max(160).optional(),
  billingEmail: emailSchema.optional(),
});

export async function convertLead(ctx: Ctx, id: string, input: unknown) {
  const data = leadConvertSchema.parse(input ?? {});
  const lead = await requireOwned(await db.lead.findUnique({ where: { id } }), "Lead", ctx.orgId);
  if (lead.convertedClientId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Lead already converted");
  }
  const wonStage = await db.pipelineStage.findFirst({ where: { orgId: ctx.orgId, isTerminalWon: true } });
  if (!wonStage) throw new AppError(ErrorCodes.INTERNAL, "No WON stage configured");

  const result = await db.$transaction(async (tx) => {
    const count = await tx.client.count({ where: { orgId: ctx.orgId, status: { not: "ARCHIVED" } } });
    await assertCapacity(ctx.orgId, "CLIENTS", count + 1);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const client = await tx.client.create({
      data: {
        orgId: ctx.orgId,
        name: data.clientName ?? lead.company ?? lead.name,
        billingEmail: data.billingEmail ?? lead.email ?? null,
        phone: lead.phone,
        website: lead.website,
        currencyCode: org.defaultCurrencyCode,
        ownerId: ctx.userId,
        status: "ACTIVE",
      },
    });
    if (lead.email || lead.phone || lead.name) {
      await tx.contact.create({
        data: {
          clientId: client.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          isPrimary: true,
        },
      });
    }
    await tx.lead.update({
      where: { id },
      data: { convertedClientId: client.id, stageId: wonStage.id, stageChangedAt: new Date() },
    });
    await tx.note.create({
      data: {
        orgId: ctx.orgId,
        entityType: "CLIENT",
        entityId: client.id,
        authorId: ctx.userId,
        body: `Converted from lead “${lead.name}”${lead.message ? `\n\nOriginal enquiry:\n${lead.message}` : ""}`,
      },
    });
    await audit(tx, ctx, "lead.converted", "CLIENT", client.id, { leadId: id });
    return client;
  });
  return result;
}

export async function discardLead(ctx: Ctx, id: string, input: unknown) {
  const { reason } = z.object({ reason: z.string().trim().max(500).default("Discarded") }).parse(input ?? {});
  const lead = await requireOwned(await db.lead.findUnique({ where: { id } }), "Lead", ctx.orgId);
  if (lead.convertedClientId) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Converted leads cannot be discarded");
  const lostStage = await db.pipelineStage.findFirst({ where: { orgId: ctx.orgId, isTerminalLost: true } });
  if (!lostStage) throw new AppError(ErrorCodes.INTERNAL, "No LOST stage configured");
  return db.lead.update({
    where: { id },
    data: { stageId: lostStage.id, lostReason: reason, stageChangedAt: new Date() },
  });
}


// ---------------------------------------------------------------------------
// §5 Client onboarding (registration → verification → KYC → contract → consent)
// ---------------------------------------------------------------------------

import { nameish as _nameish } from "../schemas";

export const ONBOARDING_DEFAULTS = [
  { key: "registration", label: "Registration & workspace created" },
  { key: "verification", label: "Identity / company verification" },
  { key: "kyc", label: "KYC documents collected" },
  { key: "contract", label: "Contract / SOW signed" },
  { key: "consent", label: "Data-processing consent recorded" },
  { key: "brand_assets", label: "Brand kit & voice received" },
  { key: "channels", label: "Channel accounts connected" },
  { key: "kickoff", label: "Kickoff meeting held" },
];

export async function instantiateOnboarding(orgId: string, clientId: string) {
  const template = await db.onboardingTemplateStep.findMany({ where: { OR: [{ orgId }, { orgId: null }] }, orderBy: { position: "asc" } });
  const steps = template.length ? template.map((t) => ({ key: t.key, label: t.label, position: t.position })) : ONBOARDING_DEFAULTS.map((d, i) => ({ ...d, position: i + 1 }));
  for (const st of steps) {
    await db.onboardingStep.upsert({
      where: { clientId_key: { clientId, key: st.key } },
      create: { orgId, clientId, key: st.key, label: st.label, position: st.position },
      update: {},
    });
  }
}

export async function listOnboarding(ctx: Ctx, clientId: string) {
  await requireOwned(await db.client.findUnique({ where: { id: clientId } }), "Client", ctx.orgId);
  const steps = await db.onboardingStep.findMany({ where: { clientId, orgId: ctx.orgId }, orderBy: { position: "asc" } });
  const done = steps.filter((x) => x.done).length;
  return { steps, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

export async function toggleOnboardingStep(ctx: Ctx, clientId: string, stepId: string) {
  await requireOwned(await db.client.findUnique({ where: { id: clientId } }), "Client", ctx.orgId);
  const step = await db.onboardingStep.findFirst({ where: { id: stepId, clientId, orgId: ctx.orgId } });
  if (!step) throw new AppError(ErrorCodes.NOT_FOUND, "Step not found");
  const updated = await db.onboardingStep.update({
    where: { id: stepId },
    data: { done: !step.done, doneAt: !step.done ? new Date() : null, doneById: !step.done ? ctx.userId : null },
  });
  await audit(db, ctx, updated.done ? "onboarding.step_done" : "onboarding.step_reopened", "CLIENT", clientId, { key: step.key });
  return updated;
}
