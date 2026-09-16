import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { codeish, nameish, bpsSchema } from "../schemas";
import { validatePattern } from "../numbering";
import type { Ctx } from "./common";
import { audit, requireOwned } from "./common";
import type { CategoryKind, Prisma, TaxRateKind } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Tax rates (groups with derived components)
// ---------------------------------------------------------------------------

export const taxRateCreateSchema = z.object({
  code: codeish,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["GST_INTRA", "GST_INTER", "FLAT", "NONE"]),
  rateBps: bpsSchema,
  gstCategory: z.string().trim().max(40).nullable().default(null),
  isDefault: z.boolean().default(false),
});

/**
 * Creating a GST group automatically materialises its components from the
 * combined rate: GST_INTRA splits evenly into CGST+SGST (largest remainder),
 * GST_INTER maps to a single IGST component. FLAT has no children.
 * Nothing here is hardcoded: halves are derived from `rateBps`.
 */
export async function createTaxRate(ctx: Ctx, input: unknown) {
  const data = taxRateCreateSchema.parse(input);
  return db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.taxRate.updateMany({ where: { orgId: ctx.orgId, isDefault: true }, data: { isDefault: false } });
    }
    const existing = await tx.taxRate.findUnique({
      where: { orgId_code: { orgId: ctx.orgId, code: data.code } },
    });
    if (existing) throw new AppError(ErrorCodes.CONFLICT, "A tax rate with this code already exists");

    const group = await tx.taxRate.create({
      data: {
        orgId: ctx.orgId,
        code: data.code,
        name: data.name,
        kind: data.kind as TaxRateKind,
        rateBps: data.rateBps,
        gstCategory: data.gstCategory,
        isDefault: data.isDefault,
      },
    });
    if (data.kind === "GST_INTRA" || data.kind === "GST_INTER") {
      const parts =
        data.kind === "GST_INTRA"
          ? [
              { label: "CGST", bps: Math.floor(data.rateBps / 2) },
              { label: "SGST", bps: data.rateBps - Math.floor(data.rateBps / 2) },
            ]
          : [{ label: "IGST", bps: data.rateBps }];
      for (const part of parts) {
        await tx.taxRate.create({
          data: {
            orgId: ctx.orgId,
            code: `${data.code}-${part.label}`,
            name: `${part.label} on ${data.name}`,
            kind: "FLAT",
            rateBps: part.bps,
            gstCategory: data.gstCategory,
            parentGroupTaxRateId: group.id,
          },
        });
      }
    }
    await audit(tx, ctx, "taxrate.created", undefined, group.id, { code: data.code, bps: data.rateBps });
    return group;
  });
}

export async function setTaxRateActive(ctx: Ctx, id: string, active: boolean) {
  const rate = await requireOwned(
    await db.taxRate.findUnique({ where: { id } }),
    "Tax rate",
    ctx.orgId,
  );
  await db.taxRate.update({ where: { id }, data: { active } });
  await audit(db, ctx, active ? "taxrate.enabled" : "taxrate.disabled", undefined, id);
  return { id: rate.id, active };
}

/**
 * Resolve which concrete tax components apply between an org (supplier) and a
 * client (place of supply). GST groups degrade gracefully to their combined
 * rate when jurisdictions are unknown (data missing, not guessed).
 */
export type ResolvedTax = { bps: number; components: Array<{ code: string; name: string; bps: number }> };

export async function resolveTax(
  tx: Prisma.TransactionClient,
  org: { state: string | null; country: string },
  client: { state: string | null; country: string; taxExempt: boolean },
  taxRateId: string | null,
): Promise<ResolvedTax> {
  if (client.taxExempt || !taxRateId) return { bps: 0, components: [] };
  const rate = await tx.taxRate.findUnique({
    where: { id: taxRateId },
    include: { components: true },
  });
  if (!rate || !rate.active) return { bps: 0, components: [] };
  if (rate.kind === "FLAT" || rate.kind === "NONE" || rate.kind === "TDS") {
    return { bps: rate.kind === "NONE" ? 0 : rate.rateBps, components: rate.kind === "NONE" ? [] : [{ code: rate.code, name: rate.name, bps: rate.rateBps }] };
  }
  const sameTerritory =
    org.country === client.country &&
    (org.state?.toLowerCase() ?? "") === (client.state?.toLowerCase() ?? "");
  if (rate.kind === "GST_INTRA") {
    if (sameTerritory) {
      return {
        bps: rate.rateBps,
        components: rate.components.map((c) => ({ code: c.code, name: c.name, bps: c.rateBps })),
      };
    }
    const inter = await tx.taxRate.findFirst({
      where: { orgId: rate.orgId ?? undefined, code: `${rate.code}-IGST`, parentGroupTaxRateId: null },
    });
    if (inter) return { bps: inter.rateBps, components: [{ code: inter.code, name: inter.name, bps: inter.rateBps }] };
    // Fallback: treat combined rate as a single charge (no IGST rate configured).
    return { bps: rate.rateBps, components: [{ code: rate.code, name: rate.name, bps: rate.rateBps }] };
  }
  // GST_INTER group configured on the line, but supply turned out intra-state:
  // prefer an equivalent GST_INTRA group (same combined rate) if one exists.
  if (sameTerritory) {
    const intra = await tx.taxRate.findFirst({
      where: { orgId: rate.orgId, kind: "GST_INTRA", rateBps: rate.rateBps, active: true },
      include: { components: true },
    });
    if (intra) {
      return {
        bps: intra.rateBps,
        components: intra.components.map((c) => ({ code: c.code, name: c.name, bps: c.rateBps })),
      };
    }
  }
  return { bps: rate.rateBps, components: rate.components.map((c) => ({ code: c.code, name: c.name, bps: c.rateBps })) };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  kind: z.enum(["SERVICE", "INDUSTRY", "LEAD_SOURCE", "EXPENSE_TYPE", "CAMPAIGN_CHANNEL", "PROJECT_TYPE"]),
  code: codeish,
  name: nameish,
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export async function createCategory(ctx: Ctx, input: unknown) {
  const data = categorySchema.parse(input);
  const cat = await db.category
    .create({ data: { orgId: ctx.orgId, ...data, kind: data.kind as CategoryKind } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A category with this code already exists in this kind");
    });
  await audit(db, ctx, "category.created", undefined, cat.id, { kind: data.kind, code: data.code });
  return cat;
}

export async function updateCategory(ctx: Ctx, id: string, input: unknown) {
  const data = categorySchema.pick({ name: true, sortOrder: true }).partial().extend({ active: z.boolean().optional() }).parse(input);
  await requireOwned(await db.category.findUnique({ where: { id } }), "Category", ctx.orgId);
  return db.category.update({ where: { id }, data });
}

export async function listCategories(ctx: Ctx, kind: CategoryKind) {
  return db.category.findMany({
    where: { kind, OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

export const stageSchema = z.object({
  code: codeish,
  name: nameish,
  winProbabilityBps: bpsSchema.default(0),
  sortOrder: z.number().int().min(0).max(999),
});

export async function createStage(ctx: Ctx, input: unknown) {
  const data = stageSchema.parse(input);
  const stage = await db.pipelineStage
    .create({ data: { orgId: ctx.orgId, ...data } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "Stage code already exists");
    });
  await audit(db, ctx, "stage.created", undefined, stage.id, { code: data.code });
  return stage;
}

export async function updateStage(ctx: Ctx, id: string, input: unknown) {
  const data = stageSchema.partial().parse(input);
  await requireOwned(
    await db.pipelineStage.findUnique({ where: { id } }),
    "Pipeline stage",
    ctx.orgId,
  );
  return db.pipelineStage.update({ where: { id }, data });
}

export async function deleteStage(ctx: Ctx, id: string) {
  const stage = await requireOwned(
    await db.pipelineStage.findUnique({ where: { id }, include: { _count: { select: { leads: true } } } }),
    "Pipeline stage",
    ctx.orgId,
  );
  if (stage.isTerminalWon || stage.isTerminalLost) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Terminal pipeline stages cannot be deleted");
  }
  if (stage._count.leads > 0) {
    throw new AppError(ErrorCodes.CONFLICT, "Stage still has leads; move them first");
  }
  await db.pipelineStage.delete({ where: { id } });
  await audit(db, ctx, "stage.deleted", undefined, id);
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

export const sequenceSchema = z.object({
  pattern: z.string().min(3).max(64),
  prefix: z.string().trim().min(1).max(12).toUpperCase(),
  padding: z.number().int().min(1).max(10),
});

export async function updateSequence(ctx: Ctx, id: string, input: unknown) {
  const data = sequenceSchema.parse(input);
  validatePattern(data.pattern);
  const seq = await requireOwned(
    await db.documentSequence.findUnique({ where: { id } }),
    "Document sequence",
    ctx.orgId,
  );
  await db.documentSequence.update({ where: { id }, data });
  await audit(db, ctx, "sequence.updated", undefined, seq.id, { pattern: data.pattern });
}

// ---------------------------------------------------------------------------
// Geo locations
// ---------------------------------------------------------------------------

export async function createGeo(ctx: Ctx, input: unknown) {
  const data = z
    .object({
      name: nameish,
      googleId: z.string().trim().max(40).nullable().default(null),
      countryCode: z.string().trim().length(2).toUpperCase().nullable().default(null),
      lat: z.number().min(-90).max(90).nullable().default(null),
      lng: z.number().min(-180).max(180).nullable().default(null),
    })
    .parse(input);
  const geo = await db.geoLocation
    .create({ data: { orgId: ctx.orgId, name: data.name, googleId: data.googleId, countryCode: data.countryCode, latE7: data.lat == null ? null : Math.round(data.lat * 1e7), lngE7: data.lng == null ? null : Math.round(data.lng * 1e7) } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "Location already exists");
    });
  await audit(db, ctx, "geo.created", undefined, geo.id);
  return geo;
}

export async function listGeos(ctx: Ctx) {
  return db.geoLocation.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }], active: true },
    orderBy: { name: "asc" },
  });
}

export async function listTaxRates(ctx: Ctx) {
  return db.taxRate.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    include: { components: { select: { id: true, code: true, name: true, rateBps: true } } },
    orderBy: [{ kind: "asc" }, { rateBps: "asc" }, { code: "asc" }],
  });
}

export async function listSequences(ctx: Ctx) {
  return db.documentSequence.findMany({ where: { orgId: ctx.orgId }, orderBy: { kind: "asc" } });
}

export async function listCurrencies() {
  return db.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } });
}

export async function listStages(ctx: Ctx) {
  return db.pipelineStage.findMany({ where: { orgId: ctx.orgId }, orderBy: { sortOrder: "asc" } });
}

export async function listPlanFeatureCatalog() {
  const rows = await db.planFeature.findMany({
    where: { plan: { status: "PUBLISHED" } },
    distinct: ["featureCode"],
    select: { featureCode: true },
    orderBy: { featureCode: "asc" },
  });
  return rows.map((r) => r.featureCode);
}
