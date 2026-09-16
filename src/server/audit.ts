import type { NoteEntityType, Prisma } from "@/generated/prisma/client";
import { db } from "./db";

export type ActivityInput = {
  orgId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: NoteEntityType;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

/**
 * Appends an immutable audit record. Call this inside the same transaction as
 * the mutation it describes so the trail and the data never disagree.
 */
export async function logActivity(
  client: Prisma.TransactionClient | typeof db,
  input: ActivityInput,
): Promise<void> {
  await client.activityLog.create({
    data: {
      orgId: input.orgId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      meta: input.meta,
      ip: input.ip,
    },
  });
}

export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip");
}
