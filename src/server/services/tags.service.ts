import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import type { Ctx } from "./common";
import { audit } from "./common";

const TAG_NAME = z.string().trim().min(1).max(40).regex(/^[\w\- ]+$/, "letters, numbers, spaces, dash, underscore");

export const tagCreateSchema = z.object({
  name: TAG_NAME,
  color: z.enum(["red", "orange", "amber", "emerald", "sky", "violet", "zinc"]).default("zinc"),
});

export const entityTypeSchema = z.enum([
  "CLIENT", "LEAD", "PROJECT", "TASK", "INVOICE", "QUOTE", "CAMPAIGN", "SUBSCRIPTION", "CONTENT",
]);

export async function listTags(ctx: Ctx) {
  return db.tag.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { linked: true } } },
  });
}

export async function upsertTag(ctx: Ctx, input: unknown) {
  const data = tagCreateSchema.parse(input);
  const name = data.name.toLowerCase();
  const tag = await db.tag.upsert({
    where: { orgId_name: { orgId: ctx.orgId, name } },
    create: { orgId: ctx.orgId, name, color: data.color },
    update: { color: data.color },
  });
  return tag;
}

/** resolve-or-create by names — used by entity forms. */
export async function resolveTags(ctx: Ctx, names: string[]) {
  const out: Array<{ id: string; name: string }> = [];
  for (const raw of names.slice(0, 25)) {
    const name = TAG_NAME.parse(raw).toLowerCase();
    const t = await db.tag.upsert({
      where: { orgId_name: { orgId: ctx.orgId, name } },
      create: { orgId: ctx.orgId, name },
      update: {},
    });
    out.push({ id: t.id, name: t.name });
  }
  return out;
}

export async function attachTags(ctx: Ctx, entityType: z.infer<typeof entityTypeSchema>, entityId: string, tagIds: string[]) {
  if (tagIds.length > 25) throw new AppError(ErrorCodes.VALIDATION, "Max 25 tags per resource");
  const owned = await db.tag.count({ where: { id: { in: tagIds }, orgId: ctx.orgId } });
  if (owned !== new Set(tagIds).size) throw new AppError(ErrorCodes.VALIDATION, "Unknown tag id");
  await db.$transaction(async (tx) => {
    await tx.resourceTag.deleteMany({ where: { orgId: ctx.orgId, entityType: entityType as never, entityId } });
    if (tagIds.length) {
      await tx.resourceTag.createMany({
        data: tagIds.map((tagId) => ({ tagId, orgId: ctx.orgId, entityType: entityType as never, entityId })),
        skipDuplicates: true,
      });
    }
    await audit(tx, ctx, "tags.set", entityType as never, entityId, { count: tagIds.length });
  });
}

export async function tagsFor(ctx: Ctx, entityType: string, entityId: string) {
  const rows = await db.resourceTag.findMany({
    where: { orgId: ctx.orgId, entityType: entityType as never, entityId },
    include: { tag: { select: { id: true, name: true, color: true } } },
  });
  return rows.map((r) => r.tag);
}

/** Filter helper used by list endpoints: tagId → entityId list */
export async function entityIdsForTag(orgId: string, tagId: string, entityType: string): Promise<string[]> {
  const rows = await db.resourceTag.findMany({
    where: { orgId, tagId, entityType: entityType as never },
    select: { entityId: true },
  });
  return rows.map((r) => r.entityId);
}
