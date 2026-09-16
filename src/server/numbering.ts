import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "./errors";
import { ErrorCodes } from "./errors";

type DbLike = Prisma.TransactionClient;

const TOKEN_RE = /\{PREFIX\}|\{YEAR\}|\{MONTH\}|\{SEQ\}/g;

export function validatePattern(pattern: string): void {
  if (!/\{SEQ\}/.test(pattern)) {
    throw new AppError(ErrorCodes.VALIDATION, "Number pattern must contain {SEQ}");
  }
  const stripped = pattern.replace(TOKEN_RE, "");
  if (/[{}]/.test(stripped)) {
    throw new AppError(
      ErrorCodes.VALIDATION,
      "Number pattern may only use {PREFIX} {YEAR} {MONTH} {SEQ} tokens",
    );
  }
  if (pattern.length > 64) {
    throw new AppError(ErrorCodes.VALIDATION, "Number pattern too long");
  }
}

/**
 * Atomically reserves the next document number for an org + kind.
 * Runs inside the caller's transaction so a rolled-back insert never
 * burns a number silently, and concurrent issuers cannot collide.
 */
export async function nextDocumentNumber(
  tx: DbLike,
  orgId: string,
  kind: "QUOTE" | "INVOICE" | "PAYMENT",
  now: Date = new Date(),
): Promise<string> {
  const rows = await tx.$queryRaw<{ pattern: string; prefix: string; padding: number; value: number }[]>`
    UPDATE "DocumentSequence"
    SET "nextValue" = "nextValue" + 1
    WHERE "orgId" = ${orgId} AND "kind"::text = ${kind}
    RETURNING pattern, prefix, padding, "nextValue" - 1 AS value
  `;
  const row = rows[0];
  if (!row) {
    throw new AppError(
      ErrorCodes.NOT_FOUND,
      `Document numbering (${kind}) is not configured for this organization`,
    );
  }
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const seq = String(row.value).padStart(row.padding, "0");
  return row.pattern
    .replaceAll("{PREFIX}", row.prefix)
    .replaceAll("{YEAR}", String(year))
    .replaceAll("{MONTH}", month)
    .replaceAll("{SEQ}", seq);
}
