/**
 * Shared token registry — registration + revocation check used by every
 * public temporal surface (booking links, ICS feeds). Tokens are stateless
 * HMAC but membership in Calendar.shareTokens makes them revocable.
 */
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { verifyToken, type TokenPayload } from "../tokens";

const TOKEN_CAP = 10;

export async function registerShareToken(calendarId: string, token: string): Promise<void> {
  const cal = await db.calendar.findUnique({ where: { id: calendarId }, select: { shareTokens: true } });
  if (!cal) throw new AppError(ErrorCodes.NOT_FOUND, "Calendar not found");
  const next = [...cal.shareTokens.filter((t) => t !== token), token].slice(-TOKEN_CAP);
  await db.calendar.update({ where: { id: calendarId }, data: { shareTokens: next } });
}

/** Verifies signature AND that the token has not been revoked. */
export async function requireShareToken(purpose: "booking_link" | "calendar_feed", token: string): Promise<TokenPayload> {
  const decoded = verifyToken(purpose, token);
  const cal = await db.calendar.findUnique({ where: { id: decoded.s }, select: { shareTokens: true } });
  if (!cal?.shareTokens.includes(token)) throw new AppError(ErrorCodes.FORBIDDEN, "Link revoked");
  return decoded;
}
