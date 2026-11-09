/**
 * TPaaS connectors — external calendar systems (Google Calendar, Microsoft
 * Graph / Office 365, CalDAV, iCal subscribe, generic REST) modelled as data.
 * Same doctrine as social connectors: template rows + per-workspace
 * connections with envelope-encrypted credentials; push/pull/bidirectional.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import { decryptSecret, encryptSecret } from "../crypto";
import { audit } from "./common";
import { emit } from "../events";
import type { Ctx } from "./common";
import { requireCalendarWrite } from "./temporal.service";
import { guardedFetch as fetch } from "../net-guard"; // SSRF-guarded: workspace-controlled URLs

function credAad(id: string): string {
  return `calconn:${id}`;
}

export const templateSchema = z.object({
  key: z.string().trim().max(40).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: nameish,
  protocol: z.enum(["GOOGLE_CALENDAR", "MICROSOFT_GRAPH", "CALDAV", "ICAL_SUBSCRIBE", "GENERIC_REST"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertConnectorTemplate(ctx: Ctx, input: unknown) {
  const data = templateSchema.parse(input);
  if (!ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Platform-admin only: connector templates are global");
  const existing = await db.calendarConnectorTemplate.findFirst({ where: { orgId: null, key: data.key } });
  return existing
    ? db.calendarConnectorTemplate.update({ where: { id: existing.id }, data: { name: data.name, protocol: data.protocol, config: data.config as object } })
    : db.calendarConnectorTemplate.create({ data: { orgId: null, key: data.key, name: data.name, protocol: data.protocol, config: data.config as object } });
}

export async function listConnectorTemplates(ctx: Ctx) {
  return db.calendarConnectorTemplate.findMany({ where: { OR: [{ orgId: null }, { orgId: ctx.orgId }] }, orderBy: { key: "asc" } });
}

export const connectSchema = z.object({
  calendarId: z.string().min(1),
  templateKey: z.string().min(1),
  externalId: z.string().max(300).nullable().optional(),
  displayName: z.string().max(120).nullable().optional(),
  direction: z.enum(["PULL", "PUSH", "BIDIRECTIONAL"]).default("BIDIRECTIONAL"),
  accessToken: z.string().max(4000).nullable().optional(),
  refreshToken: z.string().max(4000).nullable().optional(),
  username: z.string().max(200).nullable().optional(),
  password: z.string().max(500).nullable().optional(),
});

export async function connectCalendar(ctx: Ctx, input: unknown) {
  const data = connectSchema.parse(input);
  await requireCalendarWrite(ctx, data.calendarId);
  const tpl = await db.calendarConnectorTemplate.findFirst({ where: { key: data.templateKey, OR: [{ orgId: null }, { orgId: ctx.orgId }], active: true } });
  if (!tpl) throw new AppError(ErrorCodes.NOT_FOUND, `Connector "${data.templateKey}" not found`);
  const needsCreds = ["GOOGLE_CALENDAR", "MICROSOFT_GRAPH", "CALDAV", "GENERIC_REST"].includes(tpl.protocol);
  if (needsCreds && !data.accessToken && !(data.username && data.password)) {
    throw new AppError(ErrorCodes.VALIDATION, "Provide accessToken (OAuth) or username+password (CalDAV/basic)");
  }
  const created = await db.calendarConnection.create({
    data: {
      orgId: ctx.orgId,
      calendarId: data.calendarId,
      templateId: tpl.id,
      externalId: data.externalId ?? null,
      displayName: data.displayName ?? tpl.name,
      direction: data.direction as never,
      status: "PENDING",
      credentialsEnc: encryptSecret(JSON.stringify({ accessToken: data.accessToken ?? null, refreshToken: data.refreshToken ?? null, username: data.username ?? null, password: data.password ?? null }), "calconn:pending"),
      createdById: ctx.userId,
    },
  });
  await db.calendarConnection.update({ where: { id: created.id }, data: { credentialsEnc: encryptSecret(JSON.stringify({ accessToken: data.accessToken ?? null, refreshToken: data.refreshToken ?? null, username: data.username ?? null, password: data.password ?? null }), credAad(created.id)) } });
  await audit(db, ctx, "calendar.connected", undefined, created.id, { protocol: tpl.protocol, calendarId: data.calendarId });
  await emit(db, { type: "calendar.connected", aggregateType: "CALENDAR_CONNECTION", aggregateId: created.id, orgId: ctx.orgId, payload: { protocol: tpl.protocol } });
  return { id: created.id, protocol: tpl.protocol, status: "PENDING" };
}

export async function listConnections(ctx: Ctx, calendarId?: string) {
  const rows = await db.calendarConnection.findMany({
    where: { orgId: ctx.orgId, ...(calendarId ? { calendarId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { key: true, name: true, protocol: true } }, calendar: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, calendar: r.calendar.name, template: r.template, externalId: r.externalId, displayName: r.displayName, direction: r.direction, status: r.status, lastSyncAt: r.lastSyncAt, lastError: r.lastError, eventCount: r.eventCount }));
}

export async function disconnectCalendar(ctx: Ctx, id: string) {
  const conn = await db.calendarConnection.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!conn) throw new AppError(ErrorCodes.NOT_FOUND, "Connection not found");
  await db.calendarConnection.update({ where: { id }, data: { status: "DISCONNECTED", credentialsEnc: {} } });
  await audit(db, ctx, "calendar.disconnected", undefined, id);
  await emit(db, { type: "calendar.disconnected", aggregateType: "CALENDAR_CONNECTION", aggregateId: id, orgId: ctx.orgId });
  return { disconnected: true };
}

/**
 * Sync pass — real HTTP against the provider's configured endpoints.
 * GOOGLE_CALENDAR/MICROSOFT_GRAPH/GENERIC_REST: pull events JSON, upsert as
 * SINGLE ScheduledEvents; CALDAV: PROPFIND/REPORT text is parsed for VEVENTs
 * via the same ICS reader used by imports; ICAL_SUBSCRIBE: plain GET of the
 * .ics url. Bounded, idempotent (externalRef keyed), emits per-event events.
 */
export async function syncConnection(ctx: Ctx, id: string) {
  const conn = await db.calendarConnection.findUnique({ where: { id }, include: { template: true } });
  if (!conn || conn.orgId !== ctx.orgId) throw new AppError(ErrorCodes.NOT_FOUND, "Connection not found");
  if (conn.status === "DISCONNECTED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Connection is disconnected");
  const cfg = conn.template.config as Record<string, string>;
  let creds: { accessToken?: string | null; username?: string | null; password?: string | null } = {};
  try {
    creds = JSON.parse(decryptSecret(conn.credentialsEnc, credAad(conn.id)));
  } catch {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Credentials unreadable — reconnect this calendar");
  }
  const now = new Date();
  const until = new Date(now.getTime() + 90 * 86_400_000);
  let imported = 0;
  let lastError: string | null = null;
  try {
    let remote: Array<{ uid: string; title: string; start: Date; end: Date; location?: string; description?: string }> = [];
    if (conn.template.protocol === "ICAL_SUBSCRIBE") {
      if (!conn.externalId) throw new AppError(ErrorCodes.VALIDATION, "Subscribe connectors need externalId = .ics URL");
      const res = await fetch(conn.externalId, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      remote = parseIcs(await res.text(), now, until);
    } else if (conn.template.protocol === "CALDAV") {
      const base = conn.externalId ?? cfg.caldavPath;
      if (!base) throw new AppError(ErrorCodes.VALIDATION, "CalDAV connections need externalId = calendar collection URL");
      const auth = creds.username && creds.password ? `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}` : "";
      const res = await fetch(base, {
        method: "REPORT",
        headers: { "content-type": "application/xml", depth: "1", ...(auth ? { authorization: auth } : {}) },
        body: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"/></c:filter></c:calendar-query>`,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`CalDAV HTTP ${res.status}`);
      remote = parseIcs(await res.text(), now, until);
    } else {
      const apiBase = cfg.eventsPath ?? cfg.apiBase;
      if (!apiBase) throw new AppError(ErrorCodes.VALIDATION, "Connector template has no eventsPath configured");
      const url = apiBase.replace("{calendarId}", conn.externalId ?? "primary").replace("{timeMin}", now.toISOString()).replace("{timeMax}", until.toISOString());
      const res = await fetch(url, { headers: creds.accessToken ? { authorization: `Bearer ${creds.accessToken}` } : {}, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items?: Array<Record<string, unknown>>; value?: Array<Record<string, unknown>> };
      const items = json.items ?? json.value ?? [];
      remote = items.map((it) => mapProviderEvent(it, conn.template.protocol)).filter(Boolean) as typeof remote;
    }
    for (const ev of remote) {
      const ref = `ext:${conn.id}:${ev.uid}`;
      const existing = await db.scheduledEvent.findFirst({ where: { orgId: ctx.orgId, metadata: { path: ["externalRef"], equals: ref } } });
      if (existing) continue;
      await db.scheduledEvent.create({
        data: {
          orgId: ctx.orgId,
          calendarId: conn.calendarId,
          type: "SINGLE",
          title: ev.title,
          description: ev.description ?? null,
          location: ev.location ?? null,
          startsAt: ev.start,
          endsAt: ev.end,
          timezone: "UTC",
          metadata: { externalRef: ref, source: conn.template.key } as object,
          createdById: ctx.userId,
        },
      });
      imported++;
    }
    await db.calendarConnection.update({ where: { id }, data: { status: "CONNECTED", lastSyncAt: new Date(), lastError: null, eventCount: { increment: imported } } });
  } catch (e) {
    lastError = e instanceof Error ? e.message : "sync failed";
    await db.calendarConnection.update({ where: { id }, data: { status: "ERROR", lastError } });
  }
  await audit(db, ctx, "calendar.synced", undefined, id, { imported, error: lastError });
  await emit(db, { type: "calendar.synced", aggregateType: "CALENDAR_CONNECTION", aggregateId: id, orgId: ctx.orgId, payload: { imported, error: lastError } });
  return { imported, error: lastError, status: lastError ? "ERROR" : "CONNECTED" };
}

function mapProviderEvent(it: Record<string, unknown>, protocol: string) {
  const uid = String(it.id ?? it.iCalUID ?? it.uid ?? "").slice(0, 200);
  if (!uid) return null;
  if (protocol === "MICROSOFT_GRAPH") {
    const start = (it.start as { dateTime?: string } | undefined)?.dateTime;
    const end = (it.end as { dateTime?: string } | undefined)?.dateTime;
    if (!start || !end) return null;
    return { uid, title: String(it.subject ?? "(untitled)"), start: new Date(start), end: new Date(end), location: (it.location as { displayName?: string } | undefined)?.displayName, description: String((it.bodyPreview as string) ?? "") };
  }
  const start = (it.start as { dateTime?: string; date?: string } | undefined)?.dateTime ?? (it.start as { date?: string } | undefined)?.date;
  const end = (it.end as { dateTime?: string; date?: string } | undefined)?.dateTime ?? (it.end as { date?: string } | undefined)?.date;
  if (!start || !end) return null;
  return { uid, title: String(it.summary ?? it.title ?? "(untitled)"), start: new Date(start), end: new Date(end), location: typeof it.location === "string" ? it.location : undefined, description: String(it.description ?? "") };
}

/** Minimal RFC 5545 reader — handles DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION/UID. */
export function parseIcs(text: string, from: Date, to: Date) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: Array<{ uid: string; title: string; start: Date; end: Date; location?: string; description?: string }> = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (name: string) => {
      const m = new RegExp(`^${name}[^:]*:(.*)$`, "m").exec(body);
      return m ? m[1].trim() : undefined;
    };
    const parse = (v?: string) => (v ? parseIcsDate(v) : null);
    const start = parse(get("DTSTART"));
    const end = parse(get("DTEND")) ?? (start ? new Date(start.getTime() + 3_600_000) : null);
    if (!start || !end) continue;
    if (end < from || start > to) continue;
    out.push({
      uid: get("UID") ?? `ics-${start.getTime()}`,
      title: unescapeIcs(get("SUMMARY") ?? "(untitled)"),
      start,
      end,
      location: get("LOCATION") ? unescapeIcs(get("LOCATION") as string) : undefined,
      description: get("DESCRIPTION") ? unescapeIcs(get("DESCRIPTION") as string) : undefined,
    });
    if (out.length >= 500) break;
  }
  return out;
}

function parseIcsDate(v: string): Date | null {
  const s = v.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, d, h = "0", mi = "0", se = "0", z] = m;
  return z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se))
    : new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
}

function unescapeIcs(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
/** Cron pass: sync every CONNECTED/PENDING connection whose lastSyncAt is stale (>15 min). */
export async function syncDueConnections(): Promise<{ synced: number; imported: number; failed: number }> {
  const stale = new Date(Date.now() - 15 * 60_000);
  const due = await db.calendarConnection.findMany({
    where: { status: { in: ["CONNECTED", "PENDING", "ERROR"] }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: stale } }] },
    take: 50,
    orderBy: { lastSyncAt: "asc" },
  });
  let synced = 0;
  let imported = 0;
  let failed = 0;
  for (const c of due) {
    const ctx = { viewer: null as never, orgId: c.orgId, userId: c.createdById, ip: null } as Ctx;
    try {
      const res = await syncConnection(ctx, c.id);
      if (res.error) failed++;
      else {
        synced++;
        imported += res.imported;
      }
    } catch {
      failed++;
      await db.calendarConnection.update({ where: { id: c.id }, data: { status: "ERROR", lastError: "sync worker failure" } }).catch(() => undefined);
    }
  }
  await db.systemSetting.upsert({
    where: { key: "cron:calendar-sync" },
    create: { key: "cron:calendar-sync", value: { at: new Date().toISOString(), synced, imported } },
    update: { value: { at: new Date().toISOString(), synced, imported } },
  });
  return { synced, imported, failed };
}
