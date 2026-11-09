import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { AppError, ErrorCodes, errorToResponse } from "./errors";
import { getEnv } from "./env";
import { consumeBucket } from "./ratelimit";
import { resolveViewer, requireAuth, requirePermission, verifyCsrf, type Viewer } from "./context";
import { clientIp } from "./audit";
import { sha256 } from "./crypto";

export type ApiContext = {
  req: NextRequest;
  viewer: Viewer | null;
  ip: string | null;
  requestId: string;
};

export type ApiOptions = {
  auth?: "required" | "public" | "optional";
  permission?: string;
  rate?: "auth" | "api";
  /**
   * Honor `Idempotency-Key` on POSTs: replays return the stored result and
   * concurrent duplicates get 409 — safe billing mutations over flaky links.
   */
  idempotent?: boolean;
};

type Handler = (ctx: ApiContext) => Promise<Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENCY_HEADER = "idempotency-key";
const IDEM_TTL_MS = 24 * 3600_000;

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(getEnv().APP_URL).host;
  } catch {
    return false;
  }
}

export function requestId(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
}

/** Maintenance mode (platform SystemSetting) blocks non-platform-admins. */
// Read on every request — cache briefly so the flag costs ~1 query / 5s / instance.
const MAINTENANCE_TTL_MS = 5_000;
let maintenanceCache: { at: number; value: { on?: boolean; message?: string } | undefined } | null = null;

/** Drop the cached flag so a toggle takes effect on this instance immediately
 *  (other instances pick it up within MAINTENANCE_TTL_MS). */
export function invalidateMaintenanceCache(): void {
  maintenanceCache = null;
}

async function assertMaintenance(viewer: Viewer | null): Promise<void> {
  if (!maintenanceCache || Date.now() - maintenanceCache.at > MAINTENANCE_TTL_MS) {
    const row = await db.systemSetting.findUnique({ where: { key: "maintenance" } });
    maintenanceCache = { at: Date.now(), value: row?.value as { on?: boolean; message?: string } | undefined };
  }
  const m = maintenanceCache.value;
  if (!m?.on) return;
  if (viewer?.isPlatformAdmin) return;
  throw new AppError(ErrorCodes.SERVICE_UNAVAILABLE, m.message || "OmniMark is in scheduled maintenance — we'll be right back.");
}

/**
 * Wraps every API route handler with: request-id, origin/CSRF, auth, per
 * identity rate limiting, permission, maintenance mode and idempotency.
 * Services still perform row-level org scoping — this layer guards the gate.
 */
export function apiHandler(opts: ApiOptions, handler: Handler): Handler {
  return async (ctx) => {
    const { req } = ctx;
    if (MUTATING.has(req.method) && !sameOrigin(req)) {
      throw new AppError(ErrorCodes.CSRF_FAILED, "Cross-origin write blocked");
    }
    const viewer = await resolveViewer(req.headers);
    await assertMaintenance(viewer);
    if (opts.auth !== "public") {
      requireAuth(viewer);
      if (viewer!.authKind === "session" && MUTATING.has(req.method)) {
        verifyCsrf(viewer!, req.headers);
      }
      if (opts.permission) {
        requirePermission(viewer!, opts.permission);
      }
    }
    const limit = opts.rate === "auth" ? getEnv().RATE_AUTH_PER_MIN : getEnv().RATE_API_PER_MIN;
    const bucketKey = `${opts.rate ?? "api"}:${viewer?.userId ?? ctx.ip ?? "anon"}`;
    const { allowed, retryAfterSeconds } = await consumeBucket(bucketKey, limit);
    if (!allowed) {
      throw new AppError(
        ErrorCodes.RATE_LIMITED,
        `Too many requests — retry in ${retryAfterSeconds}s`,
        { retryAfterSeconds },
      );
    }

    // ---- idempotency ----
    const idemKey = opts.idempotent && req.method === "POST" ? req.headers.get(IDEMPOTENCY_HEADER)?.trim() : null;
    if (idemKey) {
      if (!/^[\w.-]{8,120}$/.test(idemKey)) {
        throw new AppError(ErrorCodes.VALIDATION, "Idempotency-Key must be 8-120 chars of letters, digits, dot, dash, underscore");
      }
      if (!viewer?.active) {
        throw new AppError(ErrorCodes.ORG_MISMATCH, "Idempotent requests require an active organization");
      }
      const orgId = viewer.active.orgId;
      const endpoint = `${req.method} ${new URL(req.url).pathname}`;
      const bodyText = await req.clone().text().catch(() => "");
      const bodyHash = sha256(bodyText);
      const mine = await db.idempotencyRecord.findUnique({ where: { orgId_key: { orgId, key: idemKey } } });
      if (mine) {
        if (mine.bodyHash !== bodyHash) {
          throw new AppError(ErrorCodes.CONFLICT, "Idempotency-Key was already used with a different request body");
        }
        if (!mine.inFlight && mine.response != null) {
          const res = mine.response as { status: number; json: unknown };
          return Response.json(res.json, {
            status: res.status,
            headers: { "idempotent-replayed": "true", "x-request-id": ctx.requestId },
          });
        }
        throw new AppError(ErrorCodes.CONFLICT, "A request with this Idempotency-Key is still in flight");
      }
      void db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
      await db.idempotencyRecord.create({
        data: {
          orgId,
          key: idemKey,
          endpoint,
          bodyHash,
          createdBy: viewer!.userId,
          expiresAt: new Date(Date.now() + IDEM_TTL_MS),
        },
      }).catch(() => {
        throw new AppError(ErrorCodes.CONFLICT, "A request with this Idempotency-Key is in flight");
      });
      let response: Response;
      try {
        response = await handler({ ...ctx, viewer });
      } catch (e) {
        await db.idempotencyRecord.deleteMany({ where: { orgId, key: idemKey } });
        throw e;
      }
      try {
        const cloned = response.clone();
        if (cloned.status < 500) {
          const json = await cloned.json().catch(() => null);
          const size = json ? JSON.stringify(json).length : 0;
          if (size < 200_000) {
            await db.idempotencyRecord.updateMany({
              where: { orgId, key: idemKey },
              data: { inFlight: false, status: cloned.status, response: { status: cloned.status, json } as object },
            });
          } else {
            await db.idempotencyRecord.deleteMany({ where: { orgId, key: idemKey } });
          }
        } else {
          await db.idempotencyRecord.deleteMany({ where: { orgId, key: idemKey } });
        }
      } catch {
        /* never break the response for bookkeeping */
      }
      return response;
    }

    return handler({ ...ctx, viewer });
  };
}

export async function route(
  req: NextRequest,
  opts: ApiOptions,
  handler: Handler,
): Promise<Response> {
  const rid = requestId(req);
  try {
    const ctx: ApiContext = { req, viewer: null, ip: clientIp(req.headers), requestId: rid };
    const res = await apiHandler(opts, handler)(ctx);
    res.headers.set("x-request-id", rid);
    return res;
  } catch (err) {
    const res = errorToResponse(err);
    res.headers.set("x-request-id", rid);
    return res;
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(ErrorCodes.VALIDATION, "Request body must be valid JSON");
  }
}

export { ErrorCodes, AppError };
