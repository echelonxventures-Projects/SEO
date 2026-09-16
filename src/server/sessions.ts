import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv } from "./env";
import { hmacHex, randomToken, sha256 } from "./crypto";
import type { User } from "@/generated/prisma/client";

export const SESSION_COOKIE = "omnimark_session";
export const ORG_COOKIE = "omnimark_org";
export const CSRF_COOKIE = "omnimark_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export function csrfValueFor(csrfSecret: string): string {
  return hmacHex(csrfSecret, "omnimark-csrf-v1");
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; csrf: string; expiresAt: Date }> {
  const token = randomToken(32);
  const csrfSecret = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfSecret,
      ip: meta.ip ?? null,
      userAgent: (meta.userAgent ?? "").slice(0, 400) || null,
      expiresAt,
    },
  });
  return { token, csrf: csrfValueFor(csrfSecret), expiresAt };
}

export async function findSessionByToken(token: string) {
  const tokenHash = sha256(token);
  return db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

export async function touchSession(sessionId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 1000 * 60 * 15);
  await db.session.updateMany({
    where: { id: sessionId, lastSeenAt: { lt: cutoff } },
    data: { lastSeenAt: new Date() },
  });
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function setAuthCookies(
  token: string,
  csrf: string,
  expiresAt: Date,
  activeOrgId: string | null,
): Promise<void> {
  const env = getEnv();
  const store = await cookies();
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.IS_PRODUCTION,
    path: "/",
    expires: expiresAt,
  };
  store.set(SESSION_COOKIE, token, base);
  store.set(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
  if (activeOrgId) {
    store.set(ORG_COOKIE, activeOrgId, base);
  } else {
    store.delete(ORG_COOKIE);
  }
}

export async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
  store.delete(ORG_COOKIE);
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt,
  };
}
