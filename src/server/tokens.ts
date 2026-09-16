import { getEnv } from "./env";
import { hmacHex, safeEqual } from "./crypto";
import { AppError, ErrorCodes } from "./errors";

export type TokenPurpose =
  | "invitation"
  | "password_reset"
  | "invoice_checkout"
  | "mfa"
  | "email_optin"
  | "email_unsub"
  | "email_open"
  | "booking_link"
  | "calendar_feed";

export type TokenPayload = {
  p: TokenPurpose;
  s: string; // subject id (invitation id / user id / invoice id)
  e: number; // expiry epoch seconds
  n: string; // nonce
};

function b64u(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function unb64u(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signToken(purpose: TokenPurpose, subjectId: string, ttlSeconds: number): string {
  const payload: TokenPayload = {
    p: purpose,
    s: subjectId,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
    n: Math.random().toString(36).slice(2, 10),
  };
  const body = b64u(JSON.stringify(payload));
  const sig = hmacHex(getEnv().TOKEN_SECRET, `${purpose}.${body}`);
  return `${body}.${sig}`;
}

export function verifyToken(purpose: TokenPurpose, token: string): TokenPayload {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) throw new AppError(ErrorCodes.VALIDATION, "Malformed token");
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacHex(getEnv().TOKEN_SECRET, `${purpose}.${body}`);
  if (!safeEqual(sig, expected)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Invalid or expired token");
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(unb64u(body)) as TokenPayload;
  } catch {
    throw new AppError(ErrorCodes.VALIDATION, "Malformed token payload");
  }
  if (payload.p !== purpose) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Token purpose mismatch");
  }
  if (payload.e < Math.floor(Date.now() / 1000)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Token has expired");
  }
  return payload;
}
