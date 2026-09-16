import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, urlish } from "../schemas";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import type { PixelPlacement, PixelPlatform } from "@/generated/prisma/client";

function normalizeDomain(raw: string): string {
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    throw new AppError(ErrorCodes.VALIDATION, "Enter a valid domain or URL");
  }
}

export const propertySchema = z.object({
  name: nameish,
  clientId: z.string().min(1),
  domain: z.string().trim().min(3).max(200),
  ga4MeasurementId: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function createProperty(ctx: Ctx, input: unknown) {
  const data = propertySchema.parse(input);
  await assertWritable(ctx.orgId);
  await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const domain = normalizeDomain(data.domain);
  const prop = await db.webProperty
    .create({
      data: {
        orgId: ctx.orgId,
        clientId: data.clientId,
        name: data.name,
        domain,
        ga4MeasurementId: data.ga4MeasurementId ?? null,
        notes: data.notes ?? null,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A property for this domain already exists");
    });
  await audit(db, ctx, "property.created", undefined, prop.id, { domain });
  return prop;
}

export async function listProperties(ctx: Ctx) {
  return db.webProperty.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      pixels: { orderBy: { createdAt: "asc" }, include: { template: { select: { id: true, key: true, label: true } } } },
    },
  });
}

export async function markVerified(ctx: Ctx, id: string) {
  await requireOwned(await db.webProperty.findUnique({ where: { id } }), "Property", ctx.orgId);
  const p = await db.webProperty.update({ where: { id }, data: { verification: "VERIFIED" } });
  await audit(db, ctx, "property.verified", undefined, id);
  return p;
}

// ---------------------------------------------------------------------------
// Tag templates — snippet shapes live in the database, not in code
// ---------------------------------------------------------------------------

export const templateSchema = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
  label: nameish,
  body: z.string().trim().min(20).max(8000),
  placement: z.enum(["HEAD", "BODY_START"]).default("HEAD"),
  docUrl: urlish.nullable().optional(),
});

export async function listTemplates(ctx: Ctx) {
  return db.pixelTemplate.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    orderBy: [{ orgId: { sort: "asc", nulls: "last" } }, { key: "asc" }],
  });
}

export async function upsertTemplate(ctx: Ctx, input: unknown, id?: string) {
  const data = templateSchema.parse(input);
  if (id) {
    const t = await requireOwned(await db.pixelTemplate.findUnique({ where: { id } }), "Tag template", ctx.orgId);
    if (t.orgId === null && !ctx.viewer.isPlatformAdmin) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Platform templates require platform access");
    }
    const updated = await db.pixelTemplate.update({ where: { id }, data: { ...data, docUrl: data.docUrl ?? null } });
    await audit(db, ctx, "pixeltemplate.updated", undefined, id, { key: data.key });
    return updated;
  }
  const created = await db.pixelTemplate
    .create({
      data: {
        orgId: ctx.orgId, // org-authored templates are always org-scoped
        ...data,
        docUrl: data.docUrl ?? null,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, `Template key ${data.key} already exists for this workspace`);
    });
  await audit(db, ctx, "pixeltemplate.created", undefined, created.id, { key: data.key });
  return created;
}

export async function toggleTemplate(ctx: Ctx, id: string, active: boolean) {
  const t = await requireOwned(await db.pixelTemplate.findUnique({ where: { id } }), "Tag template", ctx.orgId);
  if (t.orgId === null && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform templates require platform access");
  }
  await db.pixelTemplate.update({ where: { id }, data: { active } });
  await audit(db, ctx, active ? "pixeltemplate.enabled" : "pixeltemplate.disabled", undefined, id);
}

/** Org template beats global with the same key (mirrors the AI routing model). */
async function resolveTemplate(orgId: string, opts: { templateId?: string | null; key?: string }) {
  if (opts.templateId) {
    const t = await db.pixelTemplate.findUnique({ where: { id: opts.templateId } });
    if (!t || !t.active || (t.orgId !== null && t.orgId !== orgId)) return null;
    return t;
  }
  if (!opts.key) return null;
  const orgT = await db.pixelTemplate.findFirst({ where: { orgId, key: opts.key, active: true } });
  if (orgT) return orgT;
  return db.pixelTemplate.findFirst({ where: { orgId: null, key: opts.key, active: true } });
}

const SAFE_VALUE = /^[A-Za-z0-9_\-:.\/=&%#? ]{0,300}$/;

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k] ?? "";
    // Values are tag ids/domains — keep them boring; templates themselves are
    // admin-authored markup (like an email template): trusted configuration.
    return SAFE_VALUE.test(v) ? v : "";
  });
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

export const pixelSchema = z.object({
  platform: z.enum(["GOOGLE_ANALYTICS", "META_PIXEL", "TIKTOK_PIXEL", "LINKEDIN_INSIGHT", "PINTEREST_TAG", "CUSTOM"]).optional(),
  templateId: z.string().max(64).nullable().optional(),
  label: nameish,
  pixelId: z.string().trim().max(120).default(""),
  snippet: z.string().trim().max(6000).nullable().optional(),
  placement: z.enum(["HEAD", "BODY_START"]).default("HEAD"),
});

export async function addPixel(ctx: Ctx, propertyId: string, input: unknown) {
  const data = pixelSchema.parse(input);
  const prop = await requireOwned(await db.webProperty.findUnique({ where: { id: propertyId } }), "Property", ctx.orgId);

  const template = await resolveTemplate(ctx.orgId, {
    templateId: data.templateId ?? null,
    key: data.platform ?? undefined,
  });

  if (!template) {
    if (data.platform === "CUSTOM" && data.snippet) {
      // legacy raw-snippet path: raw markup stored verbatim, rendered last
      const pixel = await db.trackingPixel.create({
        data: {
          propertyId: prop.id,
          orgId: ctx.orgId,
          platform: "CUSTOM",
          label: data.label,
          pixelId: "",
          snippet: data.snippet,
          placement: data.placement,
        },
      });
      await audit(db, ctx, "pixel.created", undefined, pixel.id, { kind: "custom" });
      return pixel;
    }
    throw new AppError(
      ErrorCodes.PROVIDER_NOT_CONFIGURED,
      `No active tag template for "${data.platform ?? data.templateId}" — pick a template or add one under Tag templates.`,
    );
  }
  const pixel = await db.trackingPixel
    .create({
      data: {
        propertyId: prop.id,
        orgId: ctx.orgId,
        platform: (data.platform ?? "CUSTOM") as PixelPlatform,
        label: data.label,
        pixelId: data.pixelId,
        snippet: data.snippet ?? null,
        placement: (data.placement ?? template.placement) as PixelPlacement,
        templateId: template.id,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A pixel with this label already exists on the property");
    });
  await audit(db, ctx, "pixel.created", undefined, pixel.id, { template: template.key });
  return pixel;
}

export async function togglePixel(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.trackingPixel.findUnique({ where: { id } }), "Pixel", ctx.orgId);
  return db.trackingPixel.update({ where: { id }, data: { active } });
}

/** Full embed bundle for a property — everything rendered from DB templates. */
export async function propertySnippet(ctx: Ctx, propertyId: string): Promise<string> {
  const prop = await requireOwned(
    await db.webProperty.findUnique({
      where: { id: propertyId },
      include: {
        pixels: {
          where: { active: true },
          orderBy: [{ placement: "asc" }, { createdAt: "asc" }],
          include: { template: true },
        },
      },
    }),
    "Property",
    ctx.orgId,
  );
  const blocks: string[] = [];
  for (const p of prop.pixels) {
    if (p.template) {
      blocks.push(
        renderTemplate(p.template.body, {
          pixelId: p.pixelId,
          label: p.label,
          domain: prop.domain,
          name: prop.name,
          propertyId: prop.id,
        }),
      );
    } else if (p.snippet) {
      blocks.push(p.snippet);
    }
  }
  if (prop.ga4MeasurementId && !prop.pixels.some((p) => p.template?.key === "GOOGLE_ANALYTICS")) {
    const ga = await resolveTemplate(ctx.orgId, { key: "GOOGLE_ANALYTICS" });
    if (ga) blocks.unshift(renderTemplate(ga.body, { pixelId: prop.ga4MeasurementId, label: "GA4", domain: prop.domain, name: prop.name, propertyId: prop.id }));
  }
  return blocks.join("\n\n");
}
