/**
 * TPaaS white-label & i18n — per-workspace branding (product name, colors,
 * logos, custom domain, OEM flags) and a locale catalog with translation maps.
 * Branding is resolved by the public layout; locales override UI strings.
 */

import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import { audit } from "./common";
import type { Ctx } from "./common";

export const brandingSchema = z.object({
  productName: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().max(140).nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  loginBackgroundUrl: z.string().trim().max(500).nullable().optional(),
  customDomain: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9.-]{2,253}$/).nullable().optional(),
  emailFromName: z.string().trim().max(80).nullable().optional(),
  emailFromAddress: z.string().trim().email().max(200).nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
  oem: z.boolean().optional(),
  locale: z.string().trim().max(10).optional(),
});

export async function getBranding(ctx: Ctx) {
  return db.orgBranding.findUnique({ where: { orgId: ctx.orgId } });
}

export async function upsertBranding(ctx: Ctx, input: unknown) {
  const data = brandingSchema.parse(input);
  if ((data.oem || data.hidePoweredBy) && !(await hasWhiteLabel(ctx.orgId))) {
    throw new AppError(ErrorCodes.PLAN_LIMIT, "White-label branding is not included in your plan");
  }
  if (data.customDomain) {
    const clash = await db.orgBranding.findFirst({ where: { customDomain: data.customDomain, orgId: { not: ctx.orgId } } });
    if (clash) throw new AppError(ErrorCodes.CONFLICT, "Custom domain already in use");
  }
  const existing = await db.orgBranding.findUnique({ where: { orgId: ctx.orgId } });
  const row = existing
    ? await db.orgBranding.update({ where: { orgId: ctx.orgId }, data: { ...data } })
    : await db.orgBranding.create({ data: { orgId: ctx.orgId, ...data } });
  await audit(db, ctx, "branding.updated", undefined, row.id, { fields: Object.keys(data) });
  return row;
}

async function hasWhiteLabel(orgId: string): Promise<boolean> {
  const sub = await db.subscription.findFirst({
    where: { orgId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    orderBy: { createdAt: "desc" },
    include: { plan: { include: { features: { select: { featureCode: true } } } } },
  });
  return !!sub?.plan.features.some((f) => f.featureCode === "WHITE_LABEL");
}

export async function resolveBrandingByDomain(domain: string) {
  const row = await db.orgBranding.findFirst({ where: { customDomain: domain } });
  if (!row) return null;
  return {
    productName: row.productName,
    tagline: row.tagline,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    loginBackgroundUrl: row.loginBackgroundUrl,
    hidePoweredBy: row.hidePoweredBy,
    oem: row.oem,
    locale: row.locale,
    orgId: row.orgId,
  };
}

// ---------------------------------------------------------------------------
// Locale catalogs (i18n)
// ---------------------------------------------------------------------------

export const localeSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/),
  name: nameish,
  nativeName: nameish,
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  strings: z.record(z.string(), z.string()).default({}),
  isDefault: z.boolean().default(false),
});

export async function upsertLocale(ctx: Ctx, input: unknown) {
  const data = localeSchema.parse(input);
  const scope = ctx.viewer.isPlatformAdmin ? null : ctx.orgId;
  const existing = await db.localeCatalog.findFirst({ where: { orgId: scope, code: data.code } });
  const row = await db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.localeCatalog.updateMany({ where: { orgId: scope }, data: { isDefault: false } });
    }
    return existing
      ? tx.localeCatalog.update({ where: { id: existing.id }, data: { name: data.name, nativeName: data.nativeName, direction: data.direction, strings: data.strings as object, isDefault: data.isDefault } })
      : tx.localeCatalog.create({ data: { orgId: scope, code: data.code, name: data.name, nativeName: data.nativeName, direction: data.direction, strings: data.strings as object, isDefault: data.isDefault } });
  });
  await audit(db, ctx, "locale.upserted", undefined, row.id, { code: data.code, scope: scope ? "workspace" : "platform" });
  return row;
}

export async function listLocales(ctx: Ctx) {
  const rows = await db.localeCatalog.findMany({ where: { OR: [{ orgId: null }, { orgId: ctx.orgId }], active: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }] });
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, nativeName: r.nativeName, direction: r.direction, isDefault: r.isDefault, scope: r.orgId ? "workspace" : "platform", stringCount: Object.keys(r.strings as Record<string, string>).length }));
}

export async function resolveStrings(ctx: Ctx, code?: string) {
  const wanted = code ?? (await db.orgBranding.findUnique({ where: { orgId: ctx.orgId }, select: { locale: true } }))?.locale ?? "en-IN";
  const [org, platform] = await Promise.all([
    db.localeCatalog.findFirst({ where: { orgId: ctx.orgId, code: wanted, active: true } }),
    db.localeCatalog.findFirst({ where: { orgId: null, code: wanted, active: true } }),
  ]);
  return {
    locale: wanted,
    direction: org?.direction ?? platform?.direction ?? "ltr",
    strings: { ...((platform?.strings as Record<string, string>) ?? {}), ...((org?.strings as Record<string, string>) ?? {}) },
  };
}
/** Public: resolve branding for a custom domain (white-label login pages). */
export async function publicBranding(domain: string) {
  const row = await resolveBrandingByDomain(domain);
  if (!row) {
    return { productName: "OmniMark", primaryColor: "#6366f1", accentColor: "#22c55e", logoUrl: null, faviconUrl: null, loginBackgroundUrl: null, hidePoweredBy: false, oem: false, locale: "en-IN", custom: false };
  }
  return { ...row, custom: true };
}
