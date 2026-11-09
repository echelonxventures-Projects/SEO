import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { requireOrg, type Viewer } from "../context";
import { logActivity } from "../audit";
import type { NoteEntityType, Prisma, SubscriptionStatus } from "@/generated/prisma/client";

export type Ctx = {
  viewer: Viewer;
  orgId: string;
  userId: string;
  ip: string | null;
};

export function ctxOf(viewer: Viewer, ip: string | null): Ctx {
  const org = requireOrg(viewer);
  return { viewer, orgId: org.orgId, userId: viewer.userId, ip };
}

const WRITABLE_SUBSCRIPTION: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"];
const READ_ONLY_SUBSCRIPTION: SubscriptionStatus[] = ["CANCELLED", "EXPIRED"];

/**
 * Platform entitlement gate: tenants whose subscription lapsed keep
 * read access to their data but cannot create. TRIALING/ACTIVE get full
 * write access; PAST_DUE/GRACE keep billing writes and lose new records
 * beyond entitlement checks.
 */
export async function assertWritable(orgId: string): Promise<void> {
  const sub = await db.subscription.findFirst({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!sub) {
    throw new AppError(
      ErrorCodes.PLAN_LIMIT,
      "No active subscription — choose a plan to continue creating records",
    );
  }
  if (READ_ONLY_SUBSCRIPTION.includes(sub.status)) {
    throw new AppError(
      ErrorCodes.PLAN_LIMIT,
      "Your subscription is no longer active. Renew to unlock creating records.",
    );
  }
}

/** Enforces numeric plan limits (0/null = unlimited) for seat-style resources. */
export async function assertCapacity(
  orgId: string,
  resource: "CLIENTS" | "PROJECTS" | "KEYWORDS",
  projectedCount: number,
): Promise<void> {
  const sub = await db.subscription.findFirst({
    where: { orgId, status: { in: WRITABLE_SUBSCRIPTION } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
  if (!sub) return; // assertWritable already handles missing subs
  const max =
    resource === "CLIENTS"
      ? sub.plan.maxClients
      : resource === "PROJECTS"
        ? sub.plan.maxProjects
        : sub.plan.maxKeywords;
  if (max > 0 && projectedCount > max) {
    throw new AppError(
      ErrorCodes.PLAN_LIMIT,
      `Your plan (${sub.plan.name}) allows up to ${max} ${resource.toLowerCase()}. Upgrade to create more.`,
    );
  }
}

export async function assertFeature(orgId: string, feature: string): Promise<void> {
  const sub = await db.subscription.findFirst({
    where: { orgId, status: { in: WRITABLE_SUBSCRIPTION } },
    orderBy: { createdAt: "desc" },
    include: { plan: { include: { features: { select: { featureCode: true } } } } },
  });
  if (!sub) {
    throw new AppError(ErrorCodes.PLAN_LIMIT, "No active subscription");
  }
  if (!sub.plan.features.some((f) => f.featureCode === feature)) {
    throw new AppError(
      ErrorCodes.PLAN_LIMIT,
      `The ${feature.toLowerCase().replaceAll("_", " ")} feature is not included in your plan`,
    );
  }
}

/**
 * Row-scope guard: every per-org service read of a single record goes through
 * this. Rows whose orgId is null are platform-shared (global dictionaries,
 * PLATFORM gateways) and pass through; the caller remains responsible for any
 * extra elevation checks on platform rows.
 */
export async function requireOwned<T extends { orgId: string | null }>(
  entity: T | null,
  label: string,
  orgId: string,
): Promise<T> {
  if (!entity) throw new AppError(ErrorCodes.NOT_FOUND, `${label} not found`);
  if (entity.orgId !== null && entity.orgId !== orgId) {
    throw new AppError(ErrorCodes.NOT_FOUND, `${label} not found`);
  }
  return entity;
}

/**
 * Like requireOwned, for MUTATIONS. Platform rows (orgId = null) are shared
 * defaults every workspace reads (GST groups, categories, channels, patterns…);
 * only a platform admin may change them — otherwise one tenant could disable
 * or rewrite them for every other tenant.
 */
export async function requireOwnedForWrite<T extends { orgId: string | null }>(
  entity: T | null,
  label: string,
  ctx: Pick<Ctx, "orgId" | "viewer">,
): Promise<T> {
  const row = await requireOwned(entity, label, ctx.orgId);
  if (row.orgId === null && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      `${label} is a platform default and is read-only for workspaces — create your own instead`,
    );
  }
  return row;
}

export function audit(
  client: Prisma.TransactionClient | typeof db,
  ctx: Pick<Ctx, "orgId" | "userId" | "ip">,
  action: string,
  entityType?: NoteEntityType,
  entityId?: string,
  meta?: Prisma.InputJsonValue,
) {
  return logActivity(client, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    action,
    entityType,
    entityId,
    meta,
    ip: ctx.ip,
  });
}
