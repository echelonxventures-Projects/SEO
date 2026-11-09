/**
 * TPaaS widgets — embeddable booking / availability / appointment / scheduling
 * / calendar components. Each embed owns a rotatable public token scoped to a
 * calendar, appearance + behavior config, and origin allowlist. The public
 * widget API is auth-free but token-scoped (revocable), reusing the same
 * booking engine as the workspace.
 */

import { z } from "zod";
import crypto from "node:crypto";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import { audit } from "./common";
import { emit } from "../events";
import type { Ctx } from "./common";
import { requireCalendarWrite } from "./temporal.service";
import { meter } from "./temporal-metering.service";

export const widgetSchema = z.object({
  calendarId: z.string().min(1),
  name: nameish,
  kind: z.enum(["BOOKING", "AVAILABILITY", "APPOINTMENT", "SCHEDULING", "CALENDAR"]).default("BOOKING"),
  appearance: z.record(z.string(), z.unknown()).default({}),
  behavior: z.record(z.string(), z.unknown()).default({}),
  allowedOrigins: z.array(z.string().trim().max(300)).max(25).default([]),
});

export async function createWidget(ctx: Ctx, input: unknown) {
  const data = widgetSchema.parse(input);
  const cal = await requireCalendarWrite(ctx, data.calendarId);
  if (cal.archivedAt) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Calendar is archived");
  const token = `wgt_${crypto.randomBytes(24).toString("base64url")}`;
  const widget = await db.widgetEmbed.create({
    data: {
      orgId: ctx.orgId,
      calendarId: data.calendarId,
      name: data.name,
      kind: data.kind as never,
      token,
      appearance: data.appearance as object,
      behavior: data.behavior as object,
      allowedOrigins: data.allowedOrigins,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "widget.created", undefined, widget.id, { kind: data.kind });
  await emit(db, { type: "widget.created", aggregateType: "WIDGET_EMBED", aggregateId: widget.id, orgId: ctx.orgId, payload: { kind: data.kind } });
  return { id: widget.id, kind: widget.kind, token, embedPath: `/embed/${token}`, scriptSnippet: embedSnippet(widget.token, data.kind) };
}

export async function listWidgets(ctx: Ctx, calendarId?: string) {
  const rows = await db.widgetEmbed.findMany({
    where: { orgId: ctx.orgId, ...(calendarId ? { calendarId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { calendar: { select: { name: true } } },
  });
  return rows.map((w) => ({
    id: w.id, name: w.name, kind: w.kind, calendar: w.calendar.name, token: w.token, embedPath: `/embed/${w.token}`,
    active: w.active, views: w.views, allowedOrigins: w.allowedOrigins, appearance: w.appearance, behavior: w.behavior,
    scriptSnippet: embedSnippet(w.token, w.kind),
  }));
}

export async function updateWidget(ctx: Ctx, id: string, input: unknown) {
  const data = widgetSchema.partial().omit({ calendarId: true, kind: true }).parse(input);
  const w = await db.widgetEmbed.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!w) throw new AppError(ErrorCodes.NOT_FOUND, "Widget not found");
  const updated = await db.widgetEmbed.update({
    where: { id },
    data: {
      name: data.name,
      appearance: data.appearance as object | undefined,
      behavior: data.behavior as object | undefined,
      allowedOrigins: data.allowedOrigins,
    },
  });
  await audit(db, ctx, "widget.updated", undefined, id);
  return updated;
}

export async function toggleWidget(ctx: Ctx, id: string, active: boolean) {
  const w = await db.widgetEmbed.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!w) throw new AppError(ErrorCodes.NOT_FOUND, "Widget not found");
  return db.widgetEmbed.update({ where: { id }, data: { active } });
}

export async function rotateWidgetToken(ctx: Ctx, id: string) {
  const w = await db.widgetEmbed.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!w) throw new AppError(ErrorCodes.NOT_FOUND, "Widget not found");
  const token = `wgt_${crypto.randomBytes(24).toString("base64url")}`;
  await db.widgetEmbed.update({ where: { id }, data: { token } });
  await audit(db, ctx, "widget.token_rotated", undefined, id);
  return { token, embedPath: `/embed/${token}` };
}

export async function deleteWidget(ctx: Ctx, id: string) {
  const w = await db.widgetEmbed.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!w) throw new AppError(ErrorCodes.NOT_FOUND, "Widget not found");
  await db.widgetEmbed.delete({ where: { id } });
  await audit(db, ctx, "widget.deleted", undefined, id);
  return { deleted: true };
}

function embedSnippet(token: string, kind: string): string {
  return `<div id="omnimark-widget"></div>\n<script src="/widget.js" data-token="${token}" data-kind="${kind.toLowerCase()}" async></script>`;
}

// ---------------------------------------------------------------------------
// Public widget surface — token-scoped, origin-checked, meter-counted
// ---------------------------------------------------------------------------

export type WidgetPublic = {
  kind: string;
  appearance: Record<string, unknown>;
  calendar: { name: string; color: string; timezone: string };
  slots: Array<{ id: string; startsAt: string; endsAt: string; remaining: number }>;
  behavior: Record<string, unknown>;
};

async function loadByToken(token: string) {
  const w = await db.widgetEmbed.findUnique({ where: { token }, include: { calendar: { select: { id: true, orgId: true, name: true, color: true, timezone: true, archivedAt: true } } } });
  if (!w || !w.active || w.calendar.archivedAt) throw new AppError(ErrorCodes.NOT_FOUND, "Widget not found or inactive");
  return w;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Exact origin match (scheme + host + port). Prefix matching would let
 * `https://shop.com` admit `https://shop.com.evil.net`. An entry of the form
 * `https://*.shop.com` admits subdomains of shop.com (not shop.com itself).
 */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const o = origin ? normalizeOrigin(origin) : null;
  if (!o) return false;
  return allowed.some((entry) => {
    const wild = entry.match(/^(https?):\/\/\*\.(.+?)\/?$/i);
    if (wild) {
      const u = new URL(o);
      return u.protocol === `${wild[1].toLowerCase()}:` && u.hostname.endsWith(`.${wild[2].toLowerCase()}`);
    }
    return normalizeOrigin(entry) === o;
  });
}

/**
 * `origin` is the embedding page's origin (Origin header for API calls, the
 * Referer origin for the iframe document). Pass `undefined` only from
 * trusted server code that is not acting on behalf of an embedder.
 */
export async function publicWidget(token: string, origin: string | null | undefined): Promise<WidgetPublic> {
  const w = await loadByToken(token);
  if (origin !== undefined && !originAllowed(origin, w.allowedOrigins)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Origin not allowed for this widget");
  }
  const slots = await db.appointmentSlot.findMany({
    where: { calendarId: w.calendar.id, status: "OPEN", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 60,
  });
  await db.widgetEmbed.update({ where: { id: w.id }, data: { views: { increment: 1 } } });
  await meter(db, w.calendar.orgId, "WIDGET_VIEW", 1, { type: "WIDGET_EMBED", id: w.id });
  return {
    kind: w.kind,
    appearance: w.appearance as Record<string, unknown>,
    behavior: w.behavior as Record<string, unknown>,
    calendar: { name: w.calendar.name, color: w.calendar.color, timezone: w.calendar.timezone },
    slots: slots.filter((s) => s.booked < s.capacity).map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), remaining: s.capacity - s.booked })),
  };
}

export async function publicWidgetBook(token: string, input: unknown, ip: string | null) {
  const w = await loadByToken(token);
  const data = z.object({
    slotId: z.string().min(1),
    attendeeName: z.string().trim().min(1).max(120),
    attendeeEmail: z.string().email().nullable().optional(),
    service: z.string().max(80).nullable().optional(),
  }).parse(input);
  const { book } = await import("./temporal-booking.service");
  const ctx = { viewer: null as never, orgId: w.calendar.orgId, userId: w.createdById, ip } as Ctx;
  const result = await book(ctx, { ...data, attendeePhone: null, attendeeRefId: null, autoConfirm: true, source: `widget:${w.kind}` });
  await meter(db, w.calendar.orgId, "APPOINTMENT", 1, { type: "WIDGET_EMBED", id: w.id }, { source: "widget" });
  return {
    referenceCode: (result.appointment as { referenceCode: string }).referenceCode,
    status: (result.appointment as { status: string }).status,
    waitlisted: result.waitlisted,
  };
}