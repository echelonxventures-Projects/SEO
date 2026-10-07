import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { codeish, dateSchema, emailSchema, moneySchema, nameish } from "../schemas";
import { toMinor } from "../money";
import type { ContractStatus, KycStatus, PortalKind } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Client Governance: KYC, contracts, org hierarchies, recipient
// preferences and external portals. Client aggregate stays owned by CRM;
// everything here references it read-only.
// ===========================================================================

async function requireClient(ctx: Ctx, id: string) {
  return requireOwned(await db.client.findUnique({ where: { id } }), "Client", ctx.orgId);
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

export const kycSchema = z.object({
  status: z.enum(["NOT_STARTED", "PENDING", "REVIEW", "MANUAL_REVIEW", "APPROVED", "REJECTED", "EXPIRED"]).default("NOT_STARTED"),
  documents: z.array(z.object({ type: z.string().max(40), ref: z.string().max(300), name: z.string().max(120).optional() })).max(50).default([]),
  reviewerNote: z.string().trim().max(2000).nullable().optional(),
  expiresAt: dateSchema.nullable().optional(),
});

export async function upsertClientKyc(ctx: Ctx, clientId: string, input: unknown) {
  const data = kycSchema.parse(input);
  await assertWritable(ctx.orgId);
  await requireClient(ctx, clientId);
  const terminal = data.status === "APPROVED" || data.status === "REJECTED";
  const row = await db.clientKyc.upsert({
    where: { clientId },
    create: {
      orgId: ctx.orgId,
      clientId,
      status: data.status as KycStatus,
      documents: data.documents as object,
      reviewerNote: data.reviewerNote ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      verifiedAt: data.status === "APPROVED" ? new Date() : null,
      verifiedById: data.status === "APPROVED" ? ctx.userId : null,
    },
    update: {
      status: data.status as KycStatus,
      documents: data.documents as object,
      reviewerNote: data.reviewerNote ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      ...(terminal ? { verifiedAt: new Date(), verifiedById: ctx.userId } : {}),
    },
  });
  await audit(db, ctx, "kyc.updated", "CLIENT", clientId, { status: data.status });
  return row;
}

export async function getClientKyc(ctx: Ctx, clientId: string) {
  await requireClient(ctx, clientId);
  return db.clientKyc.findUnique({ where: { clientId } });
}

export async function listKycQueue(ctx: Ctx) {
  return db.clientKyc.findMany({
    where: { orgId: ctx.orgId, status: { in: ["PENDING", "REVIEW", "MANUAL_REVIEW"] } },
    orderBy: { updatedAt: "asc" },
    include: { client: { select: { id: true, name: true, status: true } } },
  });
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const contractSchema = z.object({
  clientId: z.string().min(1),
  code: codeish,
  name: nameish,
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  value: moneySchema.default(0),
  currencyCode: z.string().trim().length(3).toUpperCase().default("INR"),
  terms: z.string().trim().max(8000).nullable().optional(),
  fileUrl: z.string().trim().url().max(2000).nullable().optional(),
});

export async function createContract(ctx: Ctx, input: unknown) {
  const data = contractSchema.parse(input);
  await assertWritable(ctx.orgId);
  await requireClient(ctx, data.clientId);
  if (data.startDate && data.endDate && new Date(data.endDate) <= new Date(data.startDate)) {
    throw new AppError(ErrorCodes.VALIDATION, "Contract endDate must be after startDate");
  }
  const row = await db.contract
    .create({
      data: {
        orgId: ctx.orgId,
        clientId: data.clientId,
        code: data.code,
        name: data.name,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        valueMinor: toMinor(data.value),
        currencyCode: data.currencyCode,
        terms: data.terms ?? null,
        fileUrl: data.fileUrl ?? null,
        createdById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A contract with this code already exists");
    });
  await audit(db, ctx, "contract.created", "CLIENT", data.clientId, { code: row.code });
  return row;
}

export async function listContracts(ctx: Ctx, query: URLSearchParams) {
  const clientId = query.get("clientId") ?? undefined;
  const status = query.get("status") ?? undefined;
  return db.contract.findMany({
    where: { orgId: ctx.orgId, ...(clientId ? { clientId } : {}), ...(status ? { status: status as ContractStatus } : {}) },
    orderBy: { createdAt: "desc" },
    include: { client: { select: { id: true, name: true } } },
  });
}

const CONTRACT_FLOW: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["PENDING_SIGNATURE", "TERMINATED"],
  PENDING_SIGNATURE: ["SIGNED", "DRAFT", "TERMINATED"],
  SIGNED: ["ACTIVE", "TERMINATED"],
  ACTIVE: ["EXPIRED", "TERMINATED"],
  EXPIRED: ["TERMINATED"],
  TERMINATED: [],
};

export async function transitionContract(ctx: Ctx, id: string, to: ContractStatus) {
  const contract = await requireOwned(await db.contract.findUnique({ where: { id } }), "Contract", ctx.orgId);
  if (!CONTRACT_FLOW[contract.status].includes(to)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Contract cannot go ${contract.status.toLowerCase()} → ${to.toLowerCase()}`);
  }
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id },
      data: { status: to, ...(to === "SIGNED" ? { signedAt: new Date() } : {}) },
    });
    await emit(tx, { type: `contract.${to.toLowerCase()}`, aggregateType: "CLIENT", aggregateId: contract.clientId, orgId: ctx.orgId, payload: { contractId: id, code: contract.code } });
    await audit(tx, ctx, `contract.${to.toLowerCase()}`, "CLIENT", contract.clientId, { contractId: id });
    return updated;
  });
  return row;
}

/** Flag active contracts whose endDate has passed. Called by cron. */
export async function sweepContracts(): Promise<{ expired: number }> {
  const res = await db.contract.updateMany({
    where: { status: "ACTIVE", endDate: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return { expired: res.count };
}

// ---------------------------------------------------------------------------
// Org hierarchies
// ---------------------------------------------------------------------------

export const hierarchySchema = z.object({
  parentClientId: z.string().min(1),
  childClientId: z.string().min(1),
  relation: z.enum(["SUBSIDIARY", "DIVISION", "FRANCHISE", "PARTNER", "RESELLER"]).default("SUBSIDIARY"),
});

export async function addHierarchy(ctx: Ctx, input: unknown) {
  const data = hierarchySchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.parentClientId === data.childClientId) throw new AppError(ErrorCodes.VALIDATION, "A client cannot be its own parent");
  await requireClient(ctx, data.parentClientId);
  await requireClient(ctx, data.childClientId);
  const existing = await db.orgHierarchy.findUnique({ where: { parentClientId_childClientId: { parentClientId: data.parentClientId, childClientId: data.childClientId } } });
  if (existing) throw new AppError(ErrorCodes.CONFLICT, "This hierarchy link already exists");
  return db.orgHierarchy
    .create({ data: { orgId: ctx.orgId, parentClientId: data.parentClientId, childClientId: data.childClientId, relation: data.relation } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "This hierarchy link already exists");
    });
}

export async function listHierarchy(ctx: Ctx, rootClientId?: string) {
  const rows = await db.orgHierarchy.findMany({
    where: { orgId: ctx.orgId, ...(rootClientId ? { parentClientId: rootClientId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const ids = Array.from(new Set(rows.flatMap((r) => [r.parentClientId, r.childClientId])));
  const clients = await db.client.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, select: { id: true, name: true, status: true } });
  const byId = new Map(clients.map((c) => [c.id, c]));
  return rows.map((r) => ({
    id: r.id,
    relation: r.relation,
    parent: byId.get(r.parentClientId) ?? { id: r.parentClientId, name: "(missing)", status: "ARCHIVED" },
    child: byId.get(r.childClientId) ?? { id: r.childClientId, name: "(missing)", status: "ARCHIVED" },
  }));
}

/** Walk up the parent chain; guards against cycles. */
export async function ancestorsOf(ctx: Ctx, clientId: string) {
  const out: string[] = [];
  const seen = new Set<string>([clientId]);
  let cursor = clientId;
  for (let depth = 0; depth < 20; depth++) {
    const link = await db.orgHierarchy.findFirst({ where: { orgId: ctx.orgId, childClientId: cursor } });
    if (!link || seen.has(link.parentClientId)) break;
    seen.add(link.parentClientId);
    out.push(link.parentClientId);
    cursor = link.parentClientId;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recipient preferences
// ---------------------------------------------------------------------------

export const preferenceSchema = z.object({
  subjectKey: z.string().trim().min(1).max(200),
  kind: z.enum(["CHANNEL", "TIMEZONE", "CONTENT_LANGUAGE", "FREQUENCY", "TOPIC", "OPT_OUT"]),
  value: z.record(z.string(), z.unknown()).default({}),
  source: z.string().trim().max(40).default("manual"),
});

export async function setPreference(ctx: Ctx, input: unknown) {
  const data = preferenceSchema.parse(input);
  const row = await db.recipientPreference.upsert({
    where: { orgId_subjectKey_kind: { orgId: ctx.orgId, subjectKey: data.subjectKey, kind: data.kind } },
    create: { orgId: ctx.orgId, subjectKey: data.subjectKey, kind: data.kind, value: data.value as object, source: data.source },
    update: { value: data.value as object, source: data.source },
  });
  await audit(db, ctx, "preference.set", undefined, row.id, { kind: data.kind });
  return row;
}

export async function listPreferences(ctx: Ctx, subjectKey: string) {
  return db.recipientPreference.findMany({ where: { orgId: ctx.orgId, subjectKey }, orderBy: { kind: "asc" } });
}

/** An OPT_OUT preference means all channels are suppressed for the subject. */
export async function isSuppressed(ctx: Ctx, subjectKey: string): Promise<boolean> {
  const optOut = await db.recipientPreference.findUnique({ where: { orgId_subjectKey_kind: { orgId: ctx.orgId, subjectKey, kind: "OPT_OUT" } } });
  return Boolean(optOut);
}

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

const PORTAL_PERMISSIONS = ["view_reports", "view_invoices", "approve_quotes", "view_campaigns", "submit_requests"] as const;

export const portalMemberSchema = z.object({
  userId: z.string().min(1),
  clientId: z.string().max(64).nullable().optional(),
  kind: z.enum(["CLIENT", "PARTNER", "AGENCY", "ADMIN"]).default("CLIENT"),
  permissions: z.array(z.enum(PORTAL_PERMISSIONS)).max(20).default([]),
});

export async function addPortalMember(ctx: Ctx, input: unknown) {
  const data = portalMemberSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.clientId) await requireClient(ctx, data.clientId);
  const row = await db.portalMember
    .create({
      data: {
        orgId: ctx.orgId,
        clientId: data.clientId ?? null,
        userId: data.userId,
        kind: data.kind as PortalKind,
        permissions: [...data.permissions],
        invitedById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "This user already has a portal membership of that kind");
    });
  await audit(db, ctx, "portal.member_added", undefined, row.id, { kind: data.kind });
  return row;
}

export async function listPortalMembers(ctx: Ctx) {
  const rows = await db.portalMember.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } });
  const userIds = rows.map((r) => r.userId);
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, user: byId.get(r.userId) ?? { id: r.userId, name: "(unknown)", email: "" } }));
}

export async function removePortalMember(ctx: Ctx, id: string) {
  await requireOwned(await db.portalMember.findUnique({ where: { id } }), "Portal member", ctx.orgId);
  await db.portalMember.update({ where: { id }, data: { active: false } });
  await audit(db, ctx, "portal.member_removed", undefined, id);
}

export const portalInviteSchema = z.object({
  email: emailSchema,
  clientId: z.string().max(64).nullable().optional(),
  kind: z.enum(["CLIENT", "PARTNER", "AGENCY", "ADMIN"]).default("CLIENT"),
  permissions: z.array(z.enum(PORTAL_PERMISSIONS)).max(20).default([]),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export async function createPortalInvite(ctx: Ctx, input: unknown) {
  const data = portalInviteSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.clientId) await requireClient(ctx, data.clientId);
  const token = `pi_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + data.expiresInDays * 86400_000);
  const row = await db.portalInvite.create({
    data: {
      orgId: ctx.orgId,
      clientId: data.clientId ?? null,
      kind: data.kind as PortalKind,
      email: data.email,
      token,
      permissions: [...data.permissions],
      invitedById: ctx.userId,
      expiresAt,
    },
  });
  await audit(db, ctx, "portal.invite_sent", undefined, row.id, { email: data.email });
  return { id: row.id, email: row.email, kind: row.kind, expiresAt: row.expiresAt };
}

export async function listPortalInvites(ctx: Ctx) {
  return db.portalInvite.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } });
}

export async function acceptPortalInvite(token: string, userId: string) {
  const invite = await db.portalInvite.findUnique({ where: { token } });
  if (!invite) throw new AppError(ErrorCodes.NOT_FOUND, "Invite not found");
  if (invite.acceptedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Invite already accepted");
  if (invite.expiresAt < new Date()) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Invite has expired");
  return db.$transaction(async (tx) => {
    await tx.portalInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return tx.portalMember.upsert({
      where: { orgId_userId_kind: { orgId: invite.orgId, userId, kind: invite.kind } },
      create: { orgId: invite.orgId, clientId: invite.clientId, userId, kind: invite.kind, permissions: invite.permissions, invitedById: invite.invitedById },
      update: { active: true, permissions: invite.permissions },
    });
  });
}

// ---------------------------------------------------------------------------
// Client 360 rollup
// ---------------------------------------------------------------------------

export async function client360(ctx: Ctx, clientId: string) {
  const client = await requireClient(ctx, clientId);
  const [kyc, contracts, campaigns, invoices, openQuotes, hierarchyChildren] = await Promise.all([
    db.clientKyc.findUnique({ where: { clientId } }),
    db.contract.findMany({ where: { orgId: ctx.orgId, clientId }, orderBy: { createdAt: "desc" } }),
    db.campaign.findMany({ where: { orgId: ctx.orgId, clientId }, select: { id: true, name: true, lifecycle: true } }),
    db.invoice.aggregate({ where: { orgId: ctx.orgId, clientId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _sum: { totalMinor: true, paidMinor: true }, _count: true }),
    db.quote.count({ where: { orgId: ctx.orgId, clientId, status: "SENT" } }),
    db.orgHierarchy.findMany({ where: { orgId: ctx.orgId, parentClientId: clientId } }),
  ]);
  return {
    client,
    kyc,
    contracts,
    campaigns,
    receivables: {
      openInvoices: invoices._count,
      billedMinor: Number(invoices._sum.totalMinor ?? 0n),
      paidMinor: Number(invoices._sum.paidMinor ?? 0n),
      outstandingMinor: Number(invoices._sum.totalMinor ?? 0n) - Number(invoices._sum.paidMinor ?? 0n),
    },
    openQuotes,
    childCount: hierarchyChildren.length,
  };
}
