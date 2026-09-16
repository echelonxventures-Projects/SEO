import type { NextRequest } from "next/server";
import { AppError, ErrorCodes, errorToResponse } from "@/server/errors";
import { getEnv } from "@/server/env";
import { clientIp } from "@/server/audit";
import { consumeBucket } from "@/server/ratelimit";

/** Shared guard for public auth endpoints: origin + per-endpoint, per-IP token bucket. */
export async function authGuard(req: NextRequest, bucket = "auth"): Promise<void> {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(getEnv().APP_URL).host) {
        throw new AppError(ErrorCodes.CSRF_FAILED, "Cross-origin auth request blocked");
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(ErrorCodes.CSRF_FAILED, "Invalid origin");
    }
  }
  const ip = clientIp(req.headers) ?? "unknown";
  const { allowed, retryAfterSeconds } = await consumeBucket(`auth:${bucket}:${ip}`, getEnv().RATE_AUTH_PER_MIN);
  if (!allowed) {
    throw new AppError(ErrorCodes.RATE_LIMITED, `Too many attempts. Retry in ${retryAfterSeconds}s.`, {
      retryAfterSeconds,
    });
  }
}

export async function readBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(ErrorCodes.VALIDATION, "Request body must be valid JSON");
  }
}

export { errorToResponse };
