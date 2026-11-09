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

/**
 * Resolves the client IP without trusting client-supplied headers.
 *
 * `X-Forwarded-For` is a list each proxy APPENDS to, so only the rightmost
 * entries — those added by proxies we operate — are trustworthy. The leftmost
 * value is whatever the client sent and must never key rate limits or
 * lockouts. `OMNI_TRUSTED_PROXY_HOPS` is the number of reverse proxies in
 * front of the app (default 1; set 0 when the app is exposed directly).
 */
export function clientIp(headers: Headers): string | null {
  const raw = Number(process.env.OMNI_TRUSTED_PROXY_HOPS ?? "1");
  const hops = Number.isInteger(raw) && raw >= 0 ? raw : 1;
  if (hops === 0) return null;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const chain = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = chain[Math.max(0, chain.length - hops)];
    if (ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip)) return ip;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real && /^[0-9a-fA-F:.]{2,45}$/.test(real) ? real : null;
}
