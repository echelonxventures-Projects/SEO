export const ErrorCodes = {
  VALIDATION: "VALIDATION",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  CSRF_FAILED: "CSRF_FAILED",
  ORG_MISMATCH: "ORG_MISMATCH",
  ILLEGAL_STATE: "ILLEGAL_STATE",
  PLAN_LIMIT: "PLAN_LIMIT",
  GATEWAY_ERROR: "GATEWAY_ERROR",
  WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  CSRF_FAILED: 403,
  ORG_MISMATCH: 403,
  ILLEGAL_STATE: 409,
  PLAN_LIMIT: 402,
  GATEWAY_ERROR: 502,
  WEBHOOK_SIGNATURE: 400,
  PROVIDER_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toPublicShape() {
    return {
      error: {
        code: this.code,
        // Never leak internal details/stacks to clients.
        message: this.code === "INTERNAL" ? "Internal server error" : this.message,
        ...(this.details !== undefined && this.code !== "INTERNAL"
          ? { details: this.details }
          : {}),
      },
    };
  }
}

export function errorToResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json(err.toPublicShape(), { status: err.status });
  }
  // Any Zod validation error (thrown by service-level schema.parse) is a 422.
  const zod = err as { name?: string; issues?: unknown };
  if (zod && (zod.name === "ZodError" || Array.isArray(zod.issues))) {
    const issues: unknown[] = Array.isArray(zod.issues) ? zod.issues : [];
    return Response.json(
      {
        error: {
          code: ErrorCodes.VALIDATION,
          message: "Validation failed",
          details: issues.map((raw) => {
            const r = raw as { path?: unknown; message?: unknown };
            return {
              path: Array.isArray(r?.path) ? r.path.join(".") : "",
              message: typeof r?.message === "string" ? r.message : "invalid",
            };
          }),
        },
      },
      { status: 422 },
    );
  }
  console.error("[unhandled-error]", err);
  return Response.json(
    { error: { code: ErrorCodes.INTERNAL, message: "Internal server error" } },
    { status: 500 },
  );
}
