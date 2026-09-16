import { cookies } from "next/headers";
import { db } from "./db";
import { AppError, ErrorCodes } from "./errors";
import { sha256, safeEqual } from "./crypto";
import {
  CSRF_HEADER,
  csrfValueFor,
  findSessionByToken,
  SESSION_COOKIE,
  ORG_COOKIE,
  touchSession,
} from "./sessions";

export type ActiveOrg = {
  orgId: string;
  orgName: string;
  orgStatus: string;
  roleCode: string;
  roleRank: number;
  permissions: Set<string>;
};

export type Viewer = {
  userId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  authKind: "session" | "apikey";
  sessionId?: string;
  apiKeyId?: string;
  expectedCsrf?: string;
  orgs: Array<{ orgId: string; orgName: string; roleCode: string; roleRank: number }>;
  active: ActiveOrg | null;
};

const BEARER_PREFIX = "Bearer ";

async function loadGrants(roleCode: string): Promise<Set<string>> {
  const role = await db.role.findUnique({
    where: { code: roleCode },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) return new Set();
  return new Set(role.permissions.map((rp) => rp.permission.code));
}

export async function resolveViewer(headers: Headers): Promise<Viewer | null> {
  const auth = headers.get("authorization");
  if (auth?.startsWith(BEARER_PREFIX)) {
    const secret = auth.slice(BEARER_PREFIX.length).trim();
    if (!secret) return null;
    const key = await db.apiKey.findUnique({ where: { keyHash: sha256(secret) } });
    if (
      !key ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt < new Date())
    ) {
      return null;
    }
    const membership = await db.membership.findUnique({
      where: { orgId_userId: { orgId: key.orgId, userId: key.createdByUserId } },
      include: { org: true, role: true },
    });
    if (!membership || membership.status !== "ACTIVE") return null;
    await db.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });
    const roleGrants = await loadGrants(membership.role.code);
    const permissions = key.scopes.length > 0 ? new Set(key.scopes) : roleGrants;
    return {
      userId: membership.userId,
      email: `apikey:${key.prefix}`,
      name: key.name,
      isPlatformAdmin: false,
      authKind: "apikey",
      apiKeyId: key.id,
      orgs: [
        {
          orgId: membership.orgId,
          orgName: membership.org.name,
          roleCode: membership.role.code,
          roleRank: membership.role.rank,
        },
      ],
      active: {
        orgId: membership.orgId,
        orgName: membership.org.name,
        orgStatus: membership.org.status,
        roleCode: membership.role.code,
        roleRank: membership.role.rank,
        permissions,
      },
    };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await findSessionByToken(token);
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  void touchSession(session.id);

  const memberships = await db.membership.findMany({
    where: { userId: session.userId, status: "ACTIVE" },
    include: { org: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  const requestedOrgId = cookieStore.get(ORG_COOKIE)?.value;
  const chosen =
    memberships.find((m) => m.orgId === requestedOrgId) ?? memberships[0] ?? null;

  let active: ActiveOrg | null = null;
  if (chosen) {
    active = {
      orgId: chosen.orgId,
      orgName: chosen.org.name,
      orgStatus: chosen.org.status,
      roleCode: chosen.role.code,
      roleRank: chosen.role.rank,
      permissions: await loadGrants(chosen.role.code),
    };
  }

  return {
    userId: session.userId,
    email: session.user.email,
    name: session.user.name,
    isPlatformAdmin: session.user.isPlatformAdmin,
    authKind: "session",
    sessionId: session.id,
    expectedCsrf: csrfValueFor(session.csrfSecret),
    orgs: memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.org.name,
      roleCode: m.role.code,
      roleRank: m.role.rank,
    })),
    active,
  };
}

export function requireAuth(viewer: Viewer | null): asserts viewer is Viewer {
  if (!viewer) {
    throw new AppError(ErrorCodes.UNAUTHENTICATED, "Authentication required");
  }
}

export function requireOrg(viewer: Viewer): ActiveOrg {
  if (!viewer.active) {
    throw new AppError(
      ErrorCodes.ORG_MISMATCH,
      "No active organization — join or create one first",
    );
  }
  if (viewer.active.orgStatus === "SUSPENDED" || viewer.active.orgStatus === "CANCELLED") {
    throw new AppError(ErrorCodes.FORBIDDEN, "Organization access is suspended");
  }
  return viewer.active;
}

export function requirePermission(viewer: Viewer, code: string): ActiveOrg {
  requireAuth(viewer);
  const org = requireOrg(viewer);
  if (!org.permissions.has(code)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `Missing permission: ${code}`);
  }
  return org;
}

export function verifyCsrf(viewer: Viewer, headers: Headers): void {
  if (viewer.authKind !== "session") return; // API keys are not ambient credentials
  const provided = headers.get(CSRF_HEADER);
  const expected = viewer.expectedCsrf;
  if (!expected || !provided || !safeEqual(provided, expected)) {
    throw new AppError(ErrorCodes.CSRF_FAILED, "CSRF token missing or invalid");
  }
}
