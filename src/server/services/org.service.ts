import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { randomToken, sha256 } from "../crypto";
import { signToken } from "../tokens";
import { sendMail } from "../mail";
import { getEnv } from "../env";
import { emailSchema, nameish } from "../schemas";
import type { Ctx } from "./common";
import { audit, requireOwned } from "./common";
import { getRoleByCode } from "./org-defaults";

export const orgUpdateSchema = z.object({
  name: nameish.optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  defaultCurrencyCode: z.string().length(3).toUpperCase().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(16).nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  taxIdType: z.string().trim().max(40).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  email: emailSchema.nullable().optional(),
  billingEmail: emailSchema.nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  logoUrl: z.string().trim().url().max(2000).nullable().optional(),
});

export async function updateOrg(ctx: Ctx, input: unknown) {
  const data = orgUpdateSchema.parse(input);
  if (data.defaultCurrencyCode) {
    const cur = await db.currency.findUnique({ where: { code: data.defaultCurrencyCode } });
    if (!cur || !cur.active) {
      throw new AppError(ErrorCodes.VALIDATION, "Unknown or inactive currency");
    }
  }
  const org = await db.organization.update({
    where: { id: ctx.orgId },
    data: {
      ...data,
      defaultCurrencyCode: data.defaultCurrencyCode ?? undefined,
    },
    select: { id: true, name: true },
  });
  await audit(db, ctx, "org.updated", undefined, org.id, { fields: Object.keys(data) });
  return org;
}

export async function listMembers(ctx: Ctx) {
  const [memberships, invitations] = await Promise.all([
    db.membership.findMany({
      where: { orgId: ctx.orgId },
      include: { user: true, role: true },
      orderBy: [{ role: { rank: "desc" } }, { createdAt: "asc" }],
    }),
    db.invitation.findMany({
      where: { orgId: ctx.orgId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    members: memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      status: m.status,
      userStatus: m.user.status,
      roleCode: m.role.code,
      roleName: m.role.name,
      roleRank: m.role.rank,
      joinedAt: m.createdAt,
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      roleCode: i.roleCode,
      expiresAt: i.expiresAt,
    })),
  };
}

export const inviteSchema = z.object({ email: emailSchema, roleCode: z.string().min(1).max(32) });

const ALLOWED_INVITE_ROLES = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"];

export async function inviteMember(ctx: Ctx, input: unknown) {
  const data = inviteSchema.parse(input);
  if (!ALLOWED_INVITE_ROLES.includes(data.roleCode)) {
    throw new AppError(ErrorCodes.VALIDATION, "Invitable roles: ADMIN, MANAGER, MEMBER, VIEWER");
  }
  const own = await db.membership.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    include: { role: true },
  });
  if (!own) throw new AppError(ErrorCodes.FORBIDDEN, "Not a member");
  const role = await getRoleByCode(db, data.roleCode);
  if (own.role.code !== "OWNER" && role.rank >= own.role.rank) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You cannot invite a role senior to your own");
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const normalized = data.email.toLowerCase();

  const invitation = await db.invitation.upsert({
    where: { orgId_emailNormalized_roleCode: { orgId: ctx.orgId, emailNormalized: normalized, roleCode: data.roleCode } },
    create: {
      orgId: ctx.orgId,
      email: data.email,
      emailNormalized: normalized,
      roleCode: data.roleCode,
      invitedById: ctx.userId,
      tokenHash: sha256(token),
      expiresAt,
    },
    update: {
      status: "PENDING",
      tokenHash: sha256(token),
      expiresAt,
      invitedById: ctx.userId,
    },
  });
  const inviteToken = signToken("invitation", invitation.id, 7 * 24 * 3600);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const inviter = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  await sendMail({
    to: data.email,
    subject: `Join ${org.name} on OmniMark`,
    text:
      `${inviter.name} invited you to join ${org.name} on OmniMark as ${role.name}.\n\n` +
      `Accept your invitation: ${getEnv().APP_URL}/invite/${inviteToken}\n\n` +
      `This invitation expires on ${expiresAt.toISOString()}.`,
  });
  await audit(db, ctx, "member.invited", undefined, invitation.id, { email: normalized, roleCode: data.roleCode });
  return { id: invitation.id, email: normalized, roleCode: data.roleCode };
}

export async function revokeInvitation(ctx: Ctx, id: string) {
  const inv = await requireOwned(await db.invitation.findUnique({ where: { id } }), "Invitation", ctx.orgId);
  await db.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
  await audit(db, ctx, "member.invitation_revoked", undefined, id);
}

export async function updateMemberRole(ctx: Ctx, membershipId: string, input: unknown) {
  const roleCode = z.object({ roleCode: z.string().max(32) }).parse(input).roleCode;
  const target = await requireOwned(
    await db.membership.findUnique({ where: { id: membershipId }, include: { role: true } }),
    "Membership",
    ctx.orgId,
  );
  const own = await db.membership.findUniqueOrThrow({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    include: { role: true },
  });
  const newRole = await getRoleByCode(db, roleCode);
  if (roleCode === "OWNER") {
    throw new AppError(ErrorCodes.VALIDATION, "Transfer of ownership is not supported via role edit");
  }
  if (target.role.code === "OWNER") {
    throw new AppError(ErrorCodes.FORBIDDEN, "The organization owner's role cannot be changed here");
  }
  if (own.role.code !== "OWNER" && newRole.rank >= own.role.rank) {
    throw new AppError(ErrorCodes.FORBIDDEN, "You cannot assign a role senior to your own");
  }
  await db.membership.update({ where: { id: target.id }, data: { roleId: newRole.id } });
  await audit(db, ctx, "member.role_changed", undefined, target.id, {
    userId: target.userId,
    from: target.role.code,
    to: newRole.code,
  });
}

export async function removeMember(ctx: Ctx, membershipId: string) {
  const target = await requireOwned(
    await db.membership.findUnique({ where: { id: membershipId }, include: { role: true } }),
    "Membership",
    ctx.orgId,
  );
  if (target.userId === ctx.userId) {
    throw new AppError(ErrorCodes.VALIDATION, "You cannot remove yourself — leave via workspace switch instead");
  }
  if (target.role.code === "OWNER") {
    throw new AppError(ErrorCodes.FORBIDDEN, "The organization owner cannot be removed");
  }
  await db.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: target.id } });
    await tx.projectMember.deleteMany({ where: { userId: target.userId, project: { orgId: ctx.orgId } } });
    await audit(tx, ctx, "member.removed", undefined, target.id, { userId: target.userId });
  });
}

export const createApiKeySchema = z.object({
  name: nameish,
  scopes: z.array(z.string().min(3).max(60)).max(100).default([]),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});

export async function listApiKeys(ctx: Ctx) {
  return db.apiKey.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export async function createApiKey(ctx: Ctx, input: unknown) {
  const data = createApiKeySchema.parse(input);
  if (data.scopes.length > 0) {
    const known = await db.permission.findMany({ where: { code: { in: data.scopes } } });
    if (known.length !== new Set(data.scopes).size) {
      throw new AppError(ErrorCodes.VALIDATION, "One or more scopes are not valid permission codes");
    }
    // A key can never hold more power than the member minting it.
    const held = ctx.viewer.active?.permissions ?? new Set<string>();
    const excess = data.scopes.filter((s) => !held.has(s));
    if (excess.length > 0) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        `You cannot grant scopes you do not hold: ${excess.join(", ")}`,
      );
    }
  }
  if (ctx.viewer.authKind === "apikey") {
    throw new AppError(ErrorCodes.FORBIDDEN, "API keys cannot mint other API keys");
  }
  const raw = randomToken(24);
  const secret = `omni_${raw}`; // the FULL string (prefix included) is the credential
  const record = await db.apiKey.create({
    data: {
      orgId: ctx.orgId,
      name: data.name,
      prefix: raw.slice(0, 8),
      keyHash: sha256(secret),
      scopes: data.scopes,
      expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86400_000) : null,
      createdByUserId: ctx.userId,
    },
  });
  await audit(db, ctx, "apikey.created", undefined, record.id, { name: data.name });
  return { id: record.id, name: record.name, prefix: record.prefix, secret };
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  const key = await requireOwned(await db.apiKey.findUnique({ where: { id } }), "API key", ctx.orgId);
  if (!key) throw new AppError(ErrorCodes.NOT_FOUND, "API key not found");
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, ctx, "apikey.revoked", undefined, id);
}

export async function listPermissionsCatalog() {
  const permissions = await db.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] });
  const roles = await db.role.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { rank: "desc" },
  });
  return {
    permissions,
    roles: roles.map((r) => ({
      code: r.code,
      name: r.name,
      rank: r.rank,
      permissions: r.permissions.map((rp) => rp.permission.code),
    })),
  };
}
