import { db } from "../db";
import { getEnv } from "../env";
import { AppError, ErrorCodes } from "../errors";
import { hashPassword, verifyPassword, randomToken, sha256, safeEqual } from "../crypto";
import { logActivity } from "../audit";
import { sendMail } from "../mail";
import { signToken, verifyToken } from "../tokens";
import { decryptSecret, encryptSecret } from "../crypto";
import { generateTotpSecret, otpauthUri, verifyTotp, generateRecoveryCodes, hashRecoveryCode } from "../totp";
import { createSession } from "../sessions";
import { z } from "zod";
import { emailSchema, nameish, passwordSchema } from "../schemas";
import { bootstrapOrganization, getRoleByCode, uniqueOrgSlug } from "./org-defaults";

export const registerSchema = z.object({
  name: nameish,
  email: emailSchema,
  password: passwordSchema,
  orgName: z.string().trim().min(2).max(120),
});

const OTP_TTL = 1000 * 60 * 15; // 15 minutes
const OTP_MAX_ATTEMPTS = 5;

async function issueOtp(purpose: "PASSWORD_RESET" | "EMAIL_VERIFICATION", subject: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.otpToken.create({
    data: { purpose, subject, codeHash: sha256(`${purpose}:${subject}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL) },
  });
  return code;
}

export async function consumeOtp(
  purpose: "PASSWORD_RESET" | "EMAIL_VERIFICATION",
  subject: string,
  code: string,
): Promise<void> {
  const active = await db.otpToken.findMany({
    where: { purpose, subject, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (active.length === 0) {
    throw new AppError(ErrorCodes.FORBIDDEN, "This code has expired. Request a new one.");
  }
  const hash = sha256(`${purpose}:${subject}:${code}`);
  const match = active.find((o) => safeEqual(o.codeHash, hash));
  if (!match) {
    let anyLeft = false;
    for (const o of active) {
      if (o.attempts + 1 >= OTP_MAX_ATTEMPTS) {
        await db.otpToken.update({ where: { id: o.id }, data: { consumedAt: new Date() } });
      } else {
        anyLeft = true;
        await db.otpToken.update({ where: { id: o.id }, data: { attempts: o.attempts + 1 } });
      }
    }
    if (!anyLeft) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Too many attempts. Request a new code.");
    }
    throw new AppError(ErrorCodes.FORBIDDEN, "Invalid code.");
  }
  await db.otpToken.update({ where: { id: match.id }, data: { consumedAt: new Date() } });
}

export async function register(input: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const data = registerSchema.parse(input);
  const existing = await db.user.findUnique({ where: { emailNormalized: data.email } });
  if (existing) {
    throw new AppError(ErrorCodes.CONFLICT, "An account with this email already exists");
  }
  const passwordHash = await hashPassword(data.password);

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        emailNormalized: data.email,
        passwordHash,
      },
    });
    const role = await getRoleByCode(tx, "OWNER");
    const slug = await uniqueOrgSlug(tx, data.orgName);
    const org = await tx.organization.create({
      data: {
        name: data.orgName,
        slug,
        billingEmail: data.email,
        email: data.email,
      },
    });
    await bootstrapOrganization(tx, org);
    await tx.membership.create({
      data: { orgId: org.id, userId: user.id, roleId: role.id },
    });
    await logActivity(tx, {
      orgId: org.id,
      userId: user.id,
      action: "org.created",
      entityType: undefined,
      meta: { name: org.name, slug: org.slug },
      ip: meta.ip,
    });
    return { user, org };
  });

  const verifyCode = await issueOtp("EMAIL_VERIFICATION", result.user.emailNormalized);
  await sendMail({
    to: result.user.email,
    subject: "Verify your OmniMark account",
    text:
      `Welcome to OmniMark!\n\nYour verification code is ${verifyCode} (valid 15 minutes).\n` +
      `Enter it at ${getEnv().APP_URL}/verify-email to verify ${result.user.email}.\n\n` +
      `If you did not create this account, ignore this email.`,
  });

  const session = await createSession(result.user.id, meta);
  return { userId: result.user.id, orgId: result.org.id, session };
}

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

export async function login(input: unknown, meta: { ip: string | null; userAgent: string | null }) {
  const data = loginSchema.parse(input);
  const env = getEnv();
  const user = await db.user.findUnique({ where: { emailNormalized: data.email } });

  const fail = () => new AppError(ErrorCodes.INVALID_CREDENTIALS, "Incorrect email or password");

  if (!user || !user.passwordHash) throw fail();
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(ErrorCodes.ACCOUNT_LOCKED, `Account temporarily locked. Try again in ${mins} minute(s).`);
  }
  if (user.status !== "ACTIVE") {
    throw new AppError(ErrorCodes.FORBIDDEN, "This account is suspended. Contact support.");
  }
  const okPwd = await verifyPassword(data.password, user.passwordHash);
  if (!okPwd) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= env.LOGIN_MAX_FAILURES
      ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000)
      : null;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: lock },
    });
    await logActivity(db, {
      orgId: null,
      userId: user.id,
      action: "auth.login_failed",
      meta: { attempt: failed, locked: Boolean(lock) },
      ip: meta.ip,
    });
    throw fail();
  }
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  if (user.totpEnabledAt && user.totpSecretEnc) {
    const mfaToken = signToken("mfa", user.id, 5 * 60);
    await logActivity(db, { orgId: null, userId: user.id, action: "auth.login_password_ok", ip: meta.ip });
    return { mfaRequired: true as const, mfaToken };
  }
  await logActivity(db, { orgId: null, userId: user.id, action: "auth.login", ip: meta.ip });
  const session = await createSession(user.id, meta);
  const firstMembership = await db.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return { mfaRequired: false as const, userId: user.id, activeOrgId: firstMembership?.orgId ?? null, session };
}

/** Second factor step after a correct password (code or one-time recovery code). */
export async function completeMfaLogin(
  mfaToken: string,
  code: string,
  meta: { ip: string | null; userAgent: string | null },
) {
  const payload = verifyToken("mfa", mfaToken);
  const user = await db.user.findUnique({ where: { id: payload.s } });
  if (!user?.totpSecretEnc || !user.totpEnabledAt) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Two-factor is not set up for this account");
  }
  const secret = decryptSecret(user.totpSecretEnc, `totp:${user.id}`);
  let ok = verifyTotp(secret, code);
  let usedRecovery: string | null = null;
  if (!ok) {
    const h = hashRecoveryCode(code);
    if (user.recoveryCodesHash.includes(h)) {
      ok = true;
      usedRecovery = h;
    }
  }
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: failed >= getEnv().LOGIN_MAX_FAILURES ? new Date(Date.now() + getEnv().LOGIN_LOCK_MINUTES * 60_000) : null,
      },
    });
    await logActivity(db, { orgId: null, userId: user.id, action: "auth.mfa_failed", ip: meta.ip });
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Incorrect email or password");
  }
  if (usedRecovery) {
    await db.user.update({
      where: { id: user.id },
      data: { recoveryCodesHash: user.recoveryCodesHash.filter((x) => x !== usedRecovery) },
    });
    await logActivity(db, { orgId: null, userId: user.id, action: "auth.recovery_code_used", ip: meta.ip });
  }
  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastLoginAt: new Date() } });
  await logActivity(db, { orgId: null, userId: user.id, action: "auth.login", ip: meta.ip });
  const session = await createSession(user.id, meta);
  const firstMembership = await db.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  return { userId: user.id, activeOrgId: firstMembership?.orgId ?? null, session };
}

/** Start 2FA: returns secret + otpauth URI; activation only happens on confirm. */
export async function beginTotpSetup(userId: string) {
  const secret = generateTotpSecret();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.user.update({
    where: { id: userId },
    data: { totpSecretEnc: encryptSecret(secret, `totp:${userId}`) },
  });
  return { otpauthUrl: otpauthUri(secret, user.email), secret };
}

export async function confirmTotpSetup(ctxUserId: string, code: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctxUserId } });
  if (!user.totpSecretEnc) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Start setup first");
  const secret = decryptSecret(user.totpSecretEnc, `totp:${user.id}`);
  if (!verifyTotp(secret, code)) throw new AppError(ErrorCodes.VALIDATION, "Code did not match — try the current code");
  const { codes, hashes } = generateRecoveryCodes(8);
  await db.user.update({
    where: { id: user.id },
    data: { totpEnabledAt: new Date(), recoveryCodesHash: hashes },
  });
  await logActivity(db, { orgId: null, userId: user.id, action: "auth.2fa_enabled", ip: null });
  return { recoveryCodes: codes };
}

export async function disableTotp(userId: string, password: string) {
  const account = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!account.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Password is incorrect");
  }
  await db.user.update({
    where: { id: userId },
    data: { totpEnabledAt: null, totpSecretEnc: undefined, recoveryCodesHash: [] },
  });
  await logActivity(db, { orgId: null, userId, action: "auth.2fa_disabled", ip: null });
}

/** Authenticated password change: verifies current, rotates, revokes all sessions. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ip: string | null,
) {
  const z = await import("zod");
  const parsed = (await import("../schemas")).passwordSchema.safeParse(newPassword);
  if (!parsed.success) {
    throw new AppError(ErrorCodes.VALIDATION, "New password does not meet the policy");
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, "Current password is incorrect");
  }
  const passwordHash = await hashPassword(parsed.data);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await logActivity(tx, { orgId: null, userId, action: "auth.password_changed", ip });
  });
}

export async function listMySessions(userId: string) {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    take: 30,
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
  return sessions;
}

export async function revokeMySessions(userId: string, keepSessionId: string | null, allOthers = true) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId && allOthers ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (session && !session.revokedAt) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  }
}

export async function forgotPassword(email: string): Promise<{ sent: boolean }> {
  const user = await db.user.findUnique({ where: { emailNormalized: email } });
  // Always report success to prevent account enumeration.
  if (!user || !user.passwordHash || user.status !== "ACTIVE") return { sent: true };
  const code = await issueOtp("PASSWORD_RESET", user.emailNormalized);
  await sendMail({
    to: user.email,
    subject: "Reset your OmniMark password",
    text:
      `Reset code: ${code} (valid 15 minutes).\n` +
      `Open ${getEnv().APP_URL}/reset-password and enter this code.\n\n` +
      `If you didn't request this, no action is needed — your password stays unchanged.`,
  });
  await logActivity(db, { orgId: null, userId: user.id, action: "auth.forgot_password" });
  return { sent: true };
}

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "Code must be the 6 digits from your email"),
  newPassword: passwordSchema,
});

export async function resetPassword(input: unknown, ip: string | null) {
  const data = resetPasswordSchema.parse(input);
  const user = await db.user.findUnique({ where: { emailNormalized: data.email } });
  if (!user) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Invalid or expired reset code");
  }
  await consumeOtp("PASSWORD_RESET", user.emailNormalized, data.code);
  const passwordHash = await hashPassword(data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logActivity(tx, { orgId: null, userId: user.id, action: "auth.password_reset", ip });
  });
}

export const verifyEmailSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) });

export async function verifyEmail(input: unknown) {
  const data = verifyEmailSchema.parse(input);
  const user = await db.user.findUnique({ where: { emailNormalized: data.email } });
  if (!user) throw new AppError(ErrorCodes.FORBIDDEN, "Invalid code");
  await consumeOtp("EMAIL_VERIFICATION", user.emailNormalized, data.code);
  if (!user.emailVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
}

export async function acceptInvitation(
  inviteToken: string,
  input: { name?: string; password: string },
  meta: { ip: string | null; userAgent: string | null },
) {
  const payload = verifyToken("invitation", inviteToken);
  const invitation = await db.invitation.findUnique({
    where: { id: payload.s },
    include: { org: true },
  });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    throw new AppError(ErrorCodes.FORBIDDEN, "This invitation is no longer valid");
  }
  const password = registerSchema.shape.password.parse(input.password);
  const existing = await db.user.findUnique({
    where: { emailNormalized: invitation.emailNormalized },
  });
  if (existing && existing.passwordHash) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      "An account already exists for this email. Sign in first — invitations can only activate or create accounts.",
    );
  }
  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    let u = await tx.user.findUnique({ where: { emailNormalized: invitation.emailNormalized } });
    if (!u) {
      u = await tx.user.create({
        data: {
          email: invitation.email,
          emailNormalized: invitation.emailNormalized,
          name: input.name?.trim() || invitation.email.split("@")[0],
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });
    } else if (!u.passwordHash) {
      u = await tx.user.update({ where: { id: u.id }, data: { passwordHash } });
    }
    const role = await getRoleByCode(tx, invitation.roleCode);
    const existingMembership = await tx.membership.findUnique({
      where: { orgId_userId: { orgId: invitation.orgId, userId: u.id } },
    });
    if (existingMembership) {
      throw new AppError(ErrorCodes.CONFLICT, "You are already a member of this workspace");
    }
    await tx.membership.create({
      data: { orgId: invitation.orgId, userId: u.id, roleId: role.id },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: u.id },
    });
    await logActivity(tx, {
      orgId: invitation.orgId,
      userId: u.id,
      action: "member.joined",
      meta: { roleCode: invitation.roleCode },
      ip: meta.ip,
    });
    return u;
  });
  const session = await createSession(user.id, meta);
  return { userId: user.id, orgId: invitation.orgId, session };
}

export function invitationUrl(token: string): string {
  return `${getEnv().APP_URL}/invite/${token}`;
}

export function newRawApiKey() {
  const secret = randomToken(24);
  const prefix = secret.slice(0, 8);
  return { secret, prefix, keyHash: sha256(secret), full: `omni_${secret}` };
}
