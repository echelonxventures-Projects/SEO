import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { sha256 } from "../crypto";
import { emailSchema, nameish } from "../schemas";
import { csvLine } from "../csv";
import type { AudienceKind, ConsentStatus, Prisma } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

export const audienceSchema = z.object({
  name: nameish,
  description: z.string().trim().max(1000).nullable().optional(),
  kind: z.enum(["CUSTOMER_LIST", "PROSPECT_LIST", "WEBSITE_VISITORS", "SOCIAL_FOLLOWERS", "EVENT_ATTENDEES", "LOOKALIKE_SEED", "SEGMENT"]).default("CUSTOMER_LIST"),
  clientId: z.string().max(64).nullable().optional(),
  sourceListId: z.string().max(64).nullable().optional(),
});

function identityKeyOf(v: { email?: string | null; phone?: string | null; externalId?: string | null }): string | null {
  if (v.email) return `e:${sha256(v.email.toLowerCase().trim())}`;
  if (v.phone) return `p:${sha256(v.phone.replace(/[^+\d]/g, ""))}`;
  if (v.externalId) return `x:${sha256(v.externalId.trim().toLowerCase())}`;
  return null;
}

export async function createAudience(ctx: Ctx, input: unknown) {
  const data = audienceSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  if (data.sourceListId) await requireOwned(await db.mailingList.findUnique({ where: { id: data.sourceListId } }), "Mailing list", ctx.orgId);
  const aud = await db.audience
    .create({
      data: {
        orgId: ctx.orgId,
        name: data.name,
        description: data.description ?? null,
        kind: data.kind as AudienceKind,
        clientId: data.clientId ?? null,
        sourceListId: data.sourceListId ?? null,
        source: data.sourceListId ? "MAILING_LIST_REF" : "MANUAL",
        createdById: ctx.userId,
      },
    })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "An audience with this name already exists");
    });
  if (data.sourceListId) await syncFromList(ctx, aud.id);
  await audit(db, ctx, "audience.created", undefined, aud.id, { name: aud.name });
  return aud;
}

export async function listAudiences(ctx: Ctx) {
  return db.audience.findMany({
    where: { orgId: ctx.orgId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      sourceList: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  });
}

export async function getAudience(ctx: Ctx, id: string) {
  const aud = await requireOwned(
    await db.audience.findUnique({
      where: { id },
      include: { client: { select: { name: true } }, sourceList: { select: { id: true, name: true } } },
    }),
    "Audience",
    ctx.orgId,
  );
  const stats = await db.audienceMember.groupBy({
    by: ["consent"],
    where: { audienceId: id, orgId: ctx.orgId },
    _count: true,
  });
  return {
    audience: aud,
    consentBreakdown: Object.fromEntries(stats.map((s) => [s.consent, s._count])),
    total: stats.reduce((a, s) => a + s._count, 0),
  };
}

export async function archiveAudience(ctx: Ctx, id: string) {
  await requireOwned(await db.audience.findUnique({ where: { id } }), "Audience", ctx.orgId);
  await db.audience.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(db, ctx, "audience.archived", undefined, id);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const memberSchema = z.object({
  email: emailSchema.nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  externalId: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().max(120).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(15).default([]),
  consent: z.enum(["OPT_IN", "IMPORTED_LEGACY", "EXPIRED"]).optional(),
  customFields: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
});

async function requireAudience(ctx: Ctx, id: string) {
  return requireOwned(await db.audience.findUnique({ where: { id } }), "Audience", ctx.orgId);
}

export async function addMember(ctx: Ctx, audienceId: string, input: unknown) {
  const data = memberSchema.parse(input);
  const aud = await requireAudience(ctx, audienceId);
  if (aud.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Audience is archived");
  const key = identityKeyOf(data);
  if (!key) throw new AppError(ErrorCodes.VALIDATION, "Need at least one of email, phone or externalId");
  const member = await db.audienceMember.upsert({
    where: { audienceId_identityKey: { audienceId, identityKey: key } },
    create: {
      audienceId,
      orgId: ctx.orgId,
      identityKey: key,
      email: data.email ?? null,
      emailNormalized: data.email?.toLowerCase() ?? null,
      phone: data.phone ?? null,
      name: data.name ?? null,
      company: data.company ?? null,
      tags: data.tags,
      consent: (data.consent ?? "IMPORTED_LEGACY") as ConsentStatus,
      customFields: (data.customFields ?? undefined) as object,
    },
    update: {
      name: data.name ?? undefined,
      company: data.company ?? undefined,
      tags: data.tags.length ? data.tags : undefined,
      ...(data.consent ? { consent: data.consent as ConsentStatus } : {}),
    },
  });
  await touchAudience(audienceId);
  return member;
}

export async function removeMember(ctx: Ctx, audienceId: string, memberId: string) {
  await requireAudience(ctx, audienceId);
  const m = await db.audienceMember.findFirst({ where: { id: memberId, audienceId, orgId: ctx.orgId } });
  if (!m) throw new AppError(ErrorCodes.NOT_FOUND, "Member not found");
  await db.audienceMember.delete({ where: { id: memberId } });
  await touchAudience(audienceId);
}

export async function listMembers(ctx: Ctx, audienceId: string, query: URLSearchParams) {
  await requireAudience(ctx, audienceId);
  const q = query.get("q");
  return db.audienceMember.findMany({
    where: {
      audienceId,
      orgId: ctx.orgId,
      ...(q
        ? {
            OR: [
              { emailNormalized: { contains: q.toLowerCase() } },
              { name: { contains: q, mode: "insensitive" as const } },
              { company: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { identities: { select: { id: true, type: true, display: true } } },
  });
}

/**
 * CSV import — identity columns: email, phone or id; optional name, company,
 * tags (pipe-separated), consent (opt_in|expired). Re-import updates members
 * instead of duplicating (identity-keyed).
 */
export async function importCsv(ctx: Ctx, audienceId: string, csv: string) {
  const aud = await requireAudience(ctx, audienceId);
  if (aud.status === "ARCHIVED") throw new AppError(ErrorCodes.ILLEGAL_STATE, "Audience is archived");
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new AppError(ErrorCodes.VALIDATION, "CSV needs a header row and at least one data row");
  const header = csvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => header.indexOf(name);
  if (col("email") < 0 && col("phone") < 0 && col("id") < 0 && col("externalid") < 0) {
    throw new AppError(ErrorCodes.VALIDATION, "CSV needs at least one identity column: email, phone or id");
  }
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const ops: Array<Promise<unknown>> = [];
  for (let i = 1; i < lines.length && i <= 20_000; i++) {
    const c = csvLine(lines[i]);
    const email = col("email") >= 0 ? c[col("email")]?.trim() : "";
    const phone = col("phone") >= 0 ? c[col("phone")]?.trim() : "";
    const externalId = col("id") >= 0 ? c[col("id")]?.trim() : col("externalid") >= 0 ? c[col("externalid")]?.trim() : "";
    const key = identityKeyOf({ email, phone, externalId });
    if (!key) {
      errors.push(`row ${i + 1}: no identifier`);
      continue;
    }
    const consentRaw = col("consent") >= 0 ? (c[col("consent")] ?? "").toLowerCase() : "";
    const consent: ConsentStatus = consentRaw.includes("opt") ? "OPT_IN" : consentRaw.includes("exp") ? "EXPIRED" : "IMPORTED_LEGACY";
    const tags = col("tags") >= 0 ? (c[col("tags")] ?? "").split("|").map((t) => t.trim()).filter(Boolean).slice(0, 15) : [];
    const had = await db.audienceMember.findUnique({ where: { audienceId_identityKey: { audienceId, identityKey: key } }, select: { id: true } });
    if (had) updated++;
    else created++;
    const member: Omit<Prisma.AudienceMemberUncheckedCreateInput, "id"> = {
      audienceId,
      orgId: ctx.orgId,
      identityKey: key,
      email: email || null,
      emailNormalized: email ? email.toLowerCase() : null,
      phone: phone || null,
      name: col("name") >= 0 ? c[col("name")]?.trim() || null : null,
      company: col("company") >= 0 ? c[col("company")]?.trim() || null : null,
      tags,
      consent,
    };
    ops.push(
      had
        ? db.audienceMember.update({ where: { id: had.id }, data: { name: member.name, company: member.company, tags: member.tags, consent: member.consent } })
        : db.audienceMember.create({ data: member }),
    );
  }
  await Promise.all(ops);
  await touchAudience(audienceId);
  await audit(db, ctx, "audience.imported", undefined, audienceId, { created, updated, errors: errors.length });
  return { processed: created + updated, created, updated, errors: errors.slice(0, 20) };
}

/** Re-pull confirmed subscribers from the linked mailing list. */
export async function syncFromList(ctx: Ctx, audienceId: string) {
  const aud = await requireAudience(ctx, audienceId);
  if (!aud.sourceListId) throw new AppError(ErrorCodes.VALIDATION, "Audience is not linked to a mailing list");
  const subs = await db.subscriber.findMany({ where: { listId: aud.sourceListId, status: "SUBSCRIBED" }, select: { email: true, name: true } });
  for (const s of subs) {
    const key = identityKeyOf({ email: s.email });
    if (!key) continue;
    await db.audienceMember.upsert({
      where: { audienceId_identityKey: { audienceId, identityKey: key } },
      create: { audienceId, orgId: ctx.orgId, identityKey: key, email: s.email, emailNormalized: s.email.toLowerCase(), name: s.name, consent: "OPT_IN" },
      update: { name: s.name ?? undefined, consent: "OPT_IN" },
    });
  }
  await touchAudience(audienceId);
  await audit(db, ctx, "audience.synced", undefined, audienceId, { members: subs.length });
  return { synced: subs.length };
}

async function touchAudience(id: string) {
  await db.audience.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => undefined);
}


// ---------------------------------------------------------------------------
// §7 Identity layer + rule-based segments
// ---------------------------------------------------------------------------

export const identitySchema = z.object({
  type: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,24}$/, "open set: email, phone, device, cookie, crm, external, social…"),
  value: z.string().trim().min(2).max(200),
  display: z.string().trim().max(120).nullable().optional(),
});

export async function addIdentity(ctx: Ctx, memberId: string, input: unknown) {
  const data = identitySchema.parse(input);
  const member = await db.audienceMember.findFirst({ where: { id: memberId, orgId: ctx.orgId } });
  if (!member) throw new AppError(ErrorCodes.NOT_FOUND, "Member not found");
  const normalized = data.type === "email" ? data.value.toLowerCase() : data.type === "phone" ? data.value.replace(/[^+\d]/g, "") : data.value.trim().toLowerCase();
  const valueHash = sha256(`${data.type}:${normalized}`);
  const row = await db.audienceIdentity.upsert({
    where: { memberId_type_valueHash: { memberId, type: data.type, valueHash } },
    create: { memberId, orgId: ctx.orgId, type: data.type, valueHash, display: data.display ?? null },
    update: { display: data.display ?? undefined },
  });
  await audit(db, ctx, "member.identity_added", undefined, row.id, { type: data.type });
  return { id: row.id, type: row.type, display: row.display };
}

export async function removeIdentity(ctx: Ctx, id: string) {
  const row = await db.audienceIdentity.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!row) throw new AppError(ErrorCodes.NOT_FOUND, "Identity not found");
  await db.audienceIdentity.delete({ where: { id } });
}

export async function listMemberIdentities(ctx: Ctx, memberId: string) {
  const member = await db.audienceMember.findFirst({ where: { id: memberId, orgId: ctx.orgId }, select: { id: true } });
  if (!member) throw new AppError(ErrorCodes.NOT_FOUND, "Member not found");
  return db.audienceIdentity.findMany({ where: { memberId }, select: { id: true, type: true, display: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}

const PRED = z.object({
  consent: z.enum(["OPT_IN", "IMPORTED_LEGACY", "EXPIRED"]).optional(),
  tagIncludes: z.array(z.string().max(40)).max(15).optional(),
  tagExcludes: z.array(z.string().max(40)).max(15).optional(),
  hasIdentityType: z.string().max(24).optional(),
  hasPhone: z.boolean().optional(),
  customEquals: z.object({ key: z.string().max(40), value: z.string().max(120) }).optional(),
  q: z.string().max(120).optional(),
}).strict();

export const segmentSchema = z.object({
  name: nameish,
  description: z.string().trim().max(300).nullable().optional(),
  predicate: PRED,
});

export async function createSegment(ctx: Ctx, audienceId: string, input: unknown) {
  const data = segmentSchema.parse(input);
  await requireAudience(ctx, audienceId);
  const seg = await db.segment.create({
    data: { orgId: ctx.orgId, audienceId, name: data.name, description: data.description ?? null, predicate: data.predicate as object, createdById: ctx.userId },
  }).catch(() => { throw new AppError(ErrorCodes.CONFLICT, "Segment name already used in this audience"); });
  await audit(db, ctx, "segment.created", undefined, seg.id, { audienceId });
  return seg;
}

export async function listSegments(ctx: Ctx, audienceId: string) {
  await requireAudience(ctx, audienceId);
  const segs = await db.segment.findMany({ where: { audienceId, orgId: ctx.orgId }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const s of segs) out.push({ ...s, size: (await evaluateSegment(ctx, s.id)).count });
  return out;
}

function matchesPredicate(p: z.infer<typeof PRED>, m: { consent: string; tags: string[]; phone: string | null; emailNormalized: string | null; name: string | null; company: string | null }) {
  if (p.consent && m.consent !== p.consent) return false;
  if (p.hasPhone && !m.phone) return false;
  if (p.tagIncludes?.length && !p.tagIncludes.every((t) => m.tags.includes(t))) return false;
  if (p.tagExcludes?.length && p.tagExcludes.some((t) => m.tags.includes(t))) return false;
  if (p.q) {
    const q = p.q.toLowerCase();
    const hay = [m.emailNormalized, m.name, m.company].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export async function evaluateSegment(ctx: Ctx, segmentId: string) {
  const seg = await db.segment.findFirst({ where: { id: segmentId, orgId: ctx.orgId } });
  if (!seg) throw new AppError(ErrorCodes.NOT_FOUND, "Segment not found");
  const p = seg.predicate as z.infer<typeof PRED>;
  const members = await db.audienceMember.findMany({ where: { audienceId: seg.audienceId, orgId: ctx.orgId }, take: 2000 });
  let matched = members.filter((m) => matchesPredicate(p, m));
  if (p.hasIdentityType) {
    const ids = new Set((await db.audienceIdentity.findMany({ where: { orgId: ctx.orgId, type: p.hasIdentityType }, select: { memberId: true } })).map((x) => x.memberId));
    matched = matched.filter((m) => ids.has(m.id));
  }
  if (p.customEquals) {
    const def = await db.customFieldDef.findFirst({ where: { orgId: ctx.orgId, entity: "AUDIENCE_MEMBER", key: p.customEquals.key } });
    if (!def) throw new AppError(ErrorCodes.VALIDATION, `custom field "${p.customEquals.key}" not defined for members`);
    matched = matched.filter((m) => String(((m.customFields as Record<string, unknown> | null) ?? {})[p.customEquals!.key] ?? "") === p.customEquals!.value);
  }
  return { segment: seg, count: matched.length, members: matched.slice(0, 200) };
}

export async function deleteSegment(ctx: Ctx, id: string) {
  const seg = await db.segment.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!seg) throw new AppError(ErrorCodes.NOT_FOUND, "Segment not found");
  await db.segment.delete({ where: { id } });
}
