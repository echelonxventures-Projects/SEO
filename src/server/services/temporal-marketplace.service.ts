/**
 * TPaaS marketplace — publish / subscribe / install / monetize / version /
 * certify for temporal assets (schedule templates, calendars, industry packs,
 * booking templates, workflow/automation/AI templates, compliance packages,
 * connector packages). Installations are idempotent and revenue-share aware.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, longText } from "../schemas";
import { audit } from "./common";
import { emit } from "../events";
import type { Ctx } from "./common";
import { toMinor } from "../money";
import { meter } from "./temporal-metering.service";

const KINDS = [
  "BUSINESS_HOURS", "TRADING_HOURS", "OFFICE_HOURS", "FISCAL_CALENDAR", "HOLIDAY_CALENDAR",
  "MAINTENANCE_WINDOW", "SHIFT_TEMPLATE", "INDUSTRY", "ENTERPRISE", "BOOKING", "WORKFLOW",
  "AUTOMATION", "COMPLIANCE", "LAUNCH", "SUPPORT_WINDOW", "PEAK_WINDOW", "CAPACITY_MODEL",
  "AVAILABILITY_MODEL", "AI_TEMPLATE", "DEPARTMENT", "RESOURCE_TEMPLATE",
] as const;

export const listingSchema = z.object({
  code: z.string().trim().max(60).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: nameish,
  description: longText.nullable().optional(),
  assetKind: z.enum(KINDS).default("ENTERPRISE"),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+$/).default("1.0.0"),
  bundle: z.record(z.string(), z.unknown()).default({}),
  pricingModel: z.enum(["FREE", "ONE_TIME", "SUBSCRIPTION", "USAGE", "REVENUE_SHARE", "ENTERPRISE_CONTRACT"]).default("FREE"),
  price: z.number().nonnegative().max(10_000_000).default(0),
  revenueShareBps: z.number().int().min(0).max(10_000).default(0),
  publisherName: z.string().trim().max(120).optional(),
});

export async function createListing(ctx: Ctx, input: unknown) {
  const data = listingSchema.parse(input);
  const platform = ctx.viewer.isPlatformAdmin;
  const existing = await db.marketplaceListing.findFirst({
    where: { orgId: platform ? null : ctx.orgId, code: data.code, version: data.version },
  });
  if (existing) throw new AppError(ErrorCodes.CONFLICT, `Listing ${data.code}@${data.version} already exists`);
  const listing = await db.marketplaceListing.create({
    data: {
      orgId: platform ? null : ctx.orgId,
      publisherName: data.publisherName ?? (platform ? "OmniMark" : "workspace"),
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      assetKind: data.assetKind as never,
      version: data.version,
      bundle: data.bundle as object,
      pricingModel: data.pricingModel as never,
      priceMinor: toMinor(data.price),
      revenueShareBps: data.revenueShareBps,
      status: "DRAFT",
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "marketplace.listing_created", undefined, listing.id, { code: data.code, version: data.version });
  return listing;
}

export async function listListings(ctx: Ctx, params: URLSearchParams) {
  const kind = params.get("kind") ?? undefined;
  const mine = params.get("mine") === "1";
  const rows = await db.marketplaceListing.findMany({
    where: {
      ...(mine ? { orgId: ctx.orgId } : { OR: [{ status: "PUBLISHED" }, { orgId: ctx.orgId }] }),
      ...(kind ? { assetKind: kind as never } : {}),
    },
    orderBy: [{ status: "asc" }, { installs: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const installed = new Set(
    (await db.marketplaceInstall.findMany({ where: { installerOrgId: ctx.orgId }, select: { listingId: true } })).map((i) => i.listingId),
  );
  return rows.map((l) => ({ ...l, installedByMe: installed.has(l.id), isMine: l.orgId === ctx.orgId }));
}

export async function publishListing(ctx: Ctx, id: string) {
  const l = await requireMine(ctx, id);
  if (l.certification !== "CERTIFIED" && l.orgId !== null) throw new AppError(ErrorCodes.ILLEGAL_STATE, "Workspace listings must be certified before publishing");
  const updated = await db.marketplaceListing.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  await audit(db, ctx, "marketplace.published", undefined, id, { code: l.code });
  await emit(db, { type: "marketplace.published", aggregateType: "MARKETPLACE_LISTING", aggregateId: id, orgId: ctx.orgId, payload: { code: l.code } });
  return updated;
}

export async function retireListing(ctx: Ctx, id: string) {
  const l = await requireMine(ctx, id);
  const updated = await db.marketplaceListing.update({ where: { id }, data: { status: "RETIRED" } });
  await audit(db, ctx, "marketplace.retired", undefined, id, { code: l.code });
  return updated;
}

export const certifySchema = z.object({
  decision: z.enum(["CERTIFIED", "REJECTED", "PENDING"]),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function certifyListing(ctx: Ctx, id: string, input: unknown) {
  if (!ctx.viewer.isPlatformAdmin) throw new AppError(ErrorCodes.FORBIDDEN, "Certification is platform-admin only");
  const data = certifySchema.parse(input);
  const l = await db.marketplaceListing.findUnique({ where: { id } });
  if (!l) throw new AppError(ErrorCodes.NOT_FOUND, "Listing not found");
  const updated = await db.marketplaceListing.update({
    where: { id },
    data: { certification: data.decision as never, certifiedAt: data.decision === "CERTIFIED" ? new Date() : null, certifyNote: data.note ?? null },
  });
  await audit(db, ctx, "marketplace.certified", undefined, id, { decision: data.decision, code: l.code });
  await emit(db, { type: "marketplace.certified", aggregateType: "MARKETPLACE_LISTING", aggregateId: id, orgId: l.orgId, payload: { decision: data.decision } });
  return updated;
}

/**
 * Install a listing into the caller's workspace. Idempotent per listing+org
 * (re-installs only create missing assets). Metered and revenue-share tracked.
 */
export async function installListing(ctx: Ctx, id: string) {
  const l = await db.marketplaceListing.findUnique({ where: { id } });
  if (!l) throw new AppError(ErrorCodes.NOT_FOUND, "Listing not found");
  if (l.status !== "PUBLISHED") throw new AppError(ErrorCodes.ILLEGAL_STATE, `Listing is ${l.status.toLowerCase()}`);
  const prior = await db.marketplaceInstall.findFirst({ where: { listingId: id, installerOrgId: ctx.orgId } });
  if (prior) throw new AppError(ErrorCodes.CONFLICT, `Already installed (v${prior.version}); add ${l.version} as a new listing version to upgrade`);
  const bundle = l.bundle as Record<string, unknown>;
  const created: Record<string, string[]> = { patterns: [], rules: [], shifts: [], holidayCalendars: [], fiscalCalendars: [], catalogs: [], listing: [id] };
  await db.$transaction(async (tx) => {
    for (const p of (bundle.patterns as Array<Record<string, unknown>> | undefined) ?? []) {
      const pattern = await tx.temporalPattern.create({
        data: {
          orgId: ctx.orgId,
          name: `${l.name} · ${String(p.name ?? "pattern")}`,
          description: l.description ?? null,
          type: (p.type as string ?? "WINDOW") as never,
          freq: (p.freq as string ?? "DAILY") as never,
          spec: (p.spec ?? {}) as object,
          dsl: (p.dsl as string | null) ?? null,
          timezone: (p.timezone as string | null) ?? "Asia/Kolkata",
          createdById: ctx.userId,
        },
      });
      created.patterns.push(pattern.id);
    }
    for (const r of (bundle.rules as Array<Record<string, unknown>> | undefined) ?? []) {
      const rule = await tx.temporalRule.create({
        data: {
          orgId: ctx.orgId,
          name: String(r.name ?? `${l.name} rule`),
          type: (r.type as string ?? "CUSTOM") as never,
          params: (r.params as object) ?? {},
          priority: Number(r.priority ?? 100),
          hard: Boolean(r.hard ?? true),
          createdById: ctx.userId,
        },
      });
      created.rules.push(rule.id);
    }
    for (const s of (bundle.shifts as Array<Record<string, unknown>> | undefined) ?? []) {
      const shift = await tx.shift.create({
        data: {
          orgId: ctx.orgId,
          name: String(s.name ?? "Shift"),
          code: String(s.code ?? `mkt-${l.code}-${created.shifts.length + 1}`),
          kind: (s.kind as string ?? "FIXED") as never,
          startTime: String(s.startTime ?? "09:00"),
          endTime: String(s.endTime ?? "17:00"),
          crossDay: Boolean(s.crossDay ?? false),
          color: String(s.color ?? "#0ea5e9"),
          createdById: ctx.userId,
        },
      });
      created.shifts.push(shift.id);
    }
    const hc = bundle.holidayCalendar as { code?: string; name?: string; entries?: Array<{ date: string; name: string; recurringAnnual?: boolean }> } | undefined;
    if (hc?.entries?.length) {
      const cal = await tx.holidayCalendar.create({
        data: {
          orgId: ctx.orgId,
          name: String(hc.name ?? `${l.name} holidays`),
          code: String(hc.code ?? `${l.code}-HL`),
          createdById: ctx.userId,
          entries: { create: hc.entries.map((e) => ({ orgId: ctx.orgId, date: new Date(`${e.date}T00:00:00Z`), name: e.name, recurringAnnual: !!e.recurringAnnual })) },
        },
      });
      created.holidayCalendars.push(cal.id);
    }
    const fiscal = bundle.fiscal as { code?: string; name?: string; anchorMonth?: number } | undefined;
    if (fiscal) {
      const fc = await tx.fiscalCalendar.create({
        data: { orgId: ctx.orgId, name: String(fiscal.name ?? `${l.name} fiscal`), code: String(fiscal.code ?? `${l.code}-FY`), anchorMonth: Number(fiscal.anchorMonth ?? 4), period: "QUARTERLY" },
      });
      created.fiscalCalendars.push(fc.id);
    }
    const revenueShareMinor = (BigInt(l.revenueShareBps) * l.priceMinor) / 10_000n;
    await tx.marketplaceInstall.create({
      data: { listingId: id, installerOrgId: ctx.orgId, installedById: ctx.userId, version: l.version, createdIds: created as object, priceMinor: l.priceMinor, revenueShareMinor },
    });
    await tx.marketplaceListing.update({ where: { id }, data: { installs: { increment: 1 } } });
    await audit(tx, ctx, "marketplace.installed", undefined, id, { code: l.code, version: l.version });
    await emit(tx, { type: "marketplace.installed", aggregateType: "MARKETPLACE_LISTING", aggregateId: id, orgId: ctx.orgId, payload: { code: l.code, version: l.version } });
    await meter(tx, ctx.orgId, "MARKETPLACE_INSTALL", 1, { type: "MARKETPLACE_LISTING", id }, { code: l.code });
  });
  return { listing: l.code, version: l.version, created, priceMinor: Number(l.priceMinor) };
}

export async function listInstalls(ctx: Ctx, params: URLSearchParams) {
  const scope = params.get("scope") ?? "installed"; // installed | published
  if (scope === "published") {
    return db.marketplaceInstall.findMany({ where: { listing: { orgId: ctx.orgId } }, orderBy: { createdAt: "desc" }, include: { listing: { select: { code: true, name: true, version: true } } }, take: 200 });
  }
  return db.marketplaceInstall.findMany({ where: { installerOrgId: ctx.orgId }, orderBy: { createdAt: "desc" }, include: { listing: { select: { code: true, name: true, version: true, publisherName: true } } }, take: 200 });
}

async function requireMine(ctx: Ctx, id: string) {
  const l = await db.marketplaceListing.findUnique({ where: { id } });
  const mine = l && (l.orgId === ctx.orgId || (l.orgId === null && ctx.viewer.isPlatformAdmin));
  if (!l || !mine) throw new AppError(ErrorCodes.NOT_FOUND, "Listing not found");
  return l;
}