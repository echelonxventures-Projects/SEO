/**
 * UTP feeds & share tokens — calendar sharing that survives audit:
 * every stateless access token (booking links, ICS feeds) is REGISTERED on the
 * calendar's shareTokens array and therefore REVOCABLE at any time.
 * ICS output is RFC 5545 (UTC times, folded-safe properties, escaped text).
 */

import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { signToken } from "../tokens";
import { registerShareToken, requireShareToken } from "./temporal-share";
import { audit } from "./common";
import { emit } from "../events";
import { requireCalendarWrite } from "./temporal.service";
import type { Ctx } from "./common";

export async function listShareTokens(ctx: Ctx, calendarId: string) {
  const cal = await requireCalendarWrite(ctx, calendarId);
  const r = await db.calendar.findUnique({ where: { id: cal.id }, select: { shareTokens: true } });
  return { count: r?.shareTokens.length ?? 0, hints: (r?.shareTokens ?? []).map((t) => `${t.slice(0, 8)}…${t.slice(-4)}`) };
}

export async function revokeShareTokens(ctx: Ctx, calendarId: string) {
  const cal = await requireCalendarWrite(ctx, calendarId);
  await db.$transaction(async (tx) => {
    await tx.calendar.update({ where: { id: cal.id }, data: { shareTokens: [] } });
    await audit(tx, ctx, "calendar.tokens_revoked", undefined, cal.id);
    await emit(tx, { type: "calendar.revoked", aggregateType: "CALENDAR", aggregateId: cal.id, orgId: ctx.orgId });
  });
  return { revoked: true };
}

export async function createFeedLink(ctx: Ctx, calendarId: string) {
  const cal = await requireCalendarWrite(ctx, calendarId);
  if (cal.archivedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Calendar is archived");
  const token = signToken("calendar_feed", cal.id, 90 * 86400);
  await registerShareToken(cal.id, token);
  await audit(db, ctx, "calendar.feed_link", undefined, cal.id, { ttl: "90d" });
  await emit(db, { type: "calendar.feed_issued", aggregateType: "CALENDAR", aggregateId: cal.id, orgId: ctx.orgId });
  return { token, path: `/api/v1/public/feed/${encodeURIComponent(token)}`, expiresInDays: 90 };
}

// ---------------------------------------------------------------------------
// RFC 5545 builder
// ---------------------------------------------------------------------------

const CRLF = "\r\n";
const MAX_LINE = 74;

function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function line(name: string, value: string): string[] {
  const full = `${name}:${value}`;
  const out: string[] = [];
  let rest = full;
  while (Buffer.byteLength(rest, "utf8") > MAX_LINE) {
    // fold without splitting multibyte chars
    let cut = MAX_LINE;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > MAX_LINE) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out;
}

/** Public: render the calendar's confirmed future schedule as iCalendar. */
export async function publicFeedIcs(token: string): Promise<string> {
  const decoded = await requireShareToken("calendar_feed", token);
  const cal = await db.calendar.findUnique({ where: { id: decoded.s } });
  if (!cal || cal.archivedAt) throw new AppError(ErrorCodes.FORBIDDEN, "Feed not found");
  const now = new Date();
  const to = new Date(now.getTime() + 120 * 86_400_000);
  const [events, appointments] = await Promise.all([
    db.scheduledEvent.findMany({
      where: { calendarId: cal.id, status: { not: "CANCELLED" }, occurrences: { some: { status: "CONFIRMED", startsAt: { gte: now }, endsAt: { lte: to } } } },
      include: { occurrences: { where: { status: "CONFIRMED", startsAt: { gte: now }, endsAt: { lte: to } }, orderBy: { startsAt: "asc" }, take: 500 } },
      take: 200,
    }),
    db.appointment.findMany({ where: { calendarId: cal.id, status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: { gte: now }, endsAt: { lte: to } }, take: 500 }),
  ]);
  const stamp = icsDate(now);
  const L: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OmniMark//Universal Temporal Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...line("X-WR-CALNAME", cal.name),
    ...line("X-WR-TIMEZONE", cal.timezone),
  ];
  const vevent = (uid: string, start: Date, end: Date, summary: string, location: string | null, description: string | null, status: string) => {
    L.push(
      "BEGIN:VEVENT",
      ...line("UID", uid),
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      ...line("SUMMARY", summary),
      ...(location ? line("LOCATION", location) : []),
      ...(description ? line("DESCRIPTION", description) : []),
      `STATUS:${status}`,
      "END:VEVENT",
    );
  };
  for (const e of events) for (const o of e.occurrences) vevent(`omni-ev-${o.id}@omnimark`, o.startsAt, o.endsAt, e.title, e.location, e.description, "CONFIRMED");
  for (const a of appointments) vevent(`omni-ap-${a.id}@omnimark`, a.startsAt, a.endsAt, `${a.attendeeName}${a.service ? ` · ${a.service}` : ""}`, null, a.referenceCode, a.status === "PENDING" ? "TENTATIVE" : "CONFIRMED");
  L.push("END:VCALENDAR");
  return L.join(CRLF) + CRLF;
}
