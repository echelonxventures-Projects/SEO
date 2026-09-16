import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish } from "../schemas";
import type { Ctx } from "./common";
import { audit } from "./common";

export const ENTITIES = ["CLIENT", "AUDIENCE_MEMBER", "CONTENT_POST", "OFFER", "CAMPAIGN"] as const;

export const fieldDefSchema = z.object({
  entity: z.enum(ENTITIES),
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,30}$/),
  label: nameish,
  type: z.enum(["TEXT", "NUMBER", "DATE", "BOOL", "SELECT"]).default("TEXT"),
  options: z.array(z.string().trim().max(60)).max(30).default([]),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export async function listFieldDefs(ctx: Ctx, entity: string) {
  return db.customFieldDef.findMany({ where: { orgId: ctx.orgId, entity, active: true }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
}

export async function upsertFieldDef(ctx: Ctx, input: unknown, id?: string) {
  const data = fieldDefSchema.parse(input);
  if (data.type === "SELECT" && data.options.length < 2) throw new AppError(ErrorCodes.VALIDATION, "SELECT fields need at least 2 options");
  if (id) {
    const def = await db.customFieldDef.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!def) throw new AppError(ErrorCodes.NOT_FOUND, "Field definition not found");
    const updated = await db.customFieldDef.update({ where: { id }, data: { label: data.label, options: data.options, required: data.required, active: true, sortOrder: data.sortOrder } });
    await audit(db, ctx, "customfield.updated", undefined, id);
    return updated;
  }
  const row = await db.customFieldDef.create({ data: { orgId: ctx.orgId, ...data } })
    .catch(() => { throw new AppError(ErrorCodes.CONFLICT, `key "${data.key}" already defined for ${data.entity}`); });
  await audit(db, ctx, "customfield.created", undefined, row.id, { key: row.key, entity: row.entity });
  return row;
}

export async function deactivateFieldDef(ctx: Ctx, id: string) {
  const def = await db.customFieldDef.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!def) throw new AppError(ErrorCodes.NOT_FOUND, "Field definition not found");
  await db.customFieldDef.update({ where: { id }, data: { active: false } });
}

/** Validate a customFields bag against active defs; throws on violations. */
export async function validateCustomFields(orgId: string, entity: string, values: Record<string, unknown> | null | undefined): Promise<Record<string, unknown>> {
  if (!values) return {};
  const defs = await db.customFieldDef.findMany({ where: { orgId, entity, active: true } });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) throw new AppError(ErrorCodes.VALIDATION, `Unknown custom field "${key}"`);
    if (value == null || value === "") continue;
    if (def.type === "NUMBER" && typeof value !== "number") throw new AppError(ErrorCodes.VALIDATION, `"${def.label}" must be a number`);
    if (def.type === "BOOL" && typeof value !== "boolean") throw new AppError(ErrorCodes.VALIDATION, `"${def.label}" must be true/false`);
    if (def.type === "SELECT" && !def.options.includes(String(value))) throw new AppError(ErrorCodes.VALIDATION, `"${def.label}" must be one of: ${def.options.join(", ")}`);
    if (def.type === "DATE" && Number.isNaN(Date.parse(String(value)))) throw new AppError(ErrorCodes.VALIDATION, `"${def.label}" must be a date`);
    if (typeof value === "string" && value.length > 300) throw new AppError(ErrorCodes.VALIDATION, `"${def.label}" too long`);
    clean[key] = value;
  }
  for (const def of defs) {
    if (def.required && clean[def.key] === undefined) {
      throw new AppError(ErrorCodes.VALIDATION, `Custom field "${def.label}" is required`);
    }
  }
  return clean;
}
