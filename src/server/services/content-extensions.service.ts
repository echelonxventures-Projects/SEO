import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { bpsSchema, codeish, longText, nameish, paginationSchema, skipTake } from "../schemas";
import type { ContentScoreKind, ContentVersionStatus, LocalizationStatus } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { emit } from "../events";

// ===========================================================================
// UCIP — Content lifecycle extensions: versioning, translations, scoring and
// universal content kinds. ContentPost stays owned by the content domain.
// ===========================================================================

async function requirePost(ctx: Ctx, id: string) {
  return requireOwned(await db.contentPost.findUnique({ where: { id } }), "Content post", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export const versionSchema = z.object({
  changeNote: z.string().trim().max(300).nullable().optional(),
  status: z.enum(["DRAFT", "REVIEW", "APPROVED", "SUPERSEDED"]).default("DRAFT"),
});

export async function snapshotContentVersion(ctx: Ctx, postId: string, input: unknown) {
  const data = versionSchema.parse(input);
  await assertWritable(ctx.orgId);
  const post = await requirePost(ctx, postId);
  const last = await db.contentVersion.findFirst({ where: { postId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const row = await db.contentVersion.create({
    data: {
      orgId: ctx.orgId,
      postId,
      version,
      snapshot: { title: post.title, body: post.body, hashtags: post.hashtags, linkUrl: post.linkUrl, kindId: post.kindId } as object,
      status: data.status as ContentVersionStatus,
      changeNote: data.changeNote ?? null,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "content.versioned", undefined, postId, { version });
  return row;
}

export async function listContentVersions(ctx: Ctx, postId: string) {
  await requirePost(ctx, postId);
  return db.contentVersion.findMany({ where: { postId, orgId: ctx.orgId }, orderBy: { version: "desc" } });
}

export async function restoreContentVersion(ctx: Ctx, postId: string, version: number) {
  const post = await requirePost(ctx, postId);
  const snap = await db.contentVersion.findUnique({ where: { postId_version: { postId, version } } });
  if (!snap) throw new AppError(ErrorCodes.NOT_FOUND, "Version not found");
  const s = snap.snapshot as { title?: string; body?: string; hashtags?: string[]; linkUrl?: string | null; kindId?: string | null };
  await db.$transaction(async (tx) => {
    await tx.contentPost.update({
      where: { id: postId },
      data: {
        title: s.title ?? post.title,
        body: s.body ?? post.body,
        hashtags: s.hashtags ?? post.hashtags,
        linkUrl: s.linkUrl ?? post.linkUrl,
        kindId: s.kindId ?? post.kindId,
      },
    });
    await tx.contentVersion.create({
      data: { orgId: ctx.orgId, postId, version: (await tx.contentVersion.count({ where: { postId } })) + 1, snapshot: snap.snapshot as object, status: "DRAFT", changeNote: `Restored v${version}`, createdById: ctx.userId },
    });
    await audit(tx, ctx, "content.version_restored", undefined, postId, { version });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

export const translationSchema = z.object({
  locale: z.string().trim().toLowerCase().regex(/^[a-z]{2}(-[a-z]{2})?$/, "BCP-47 style locale e.g. en, hi, en-us"),
  title: nameish,
  body: z.string().trim().min(1).max(5000),
  status: z.enum(["PENDING", "TRANSLATED", "REVIEWED", "PUBLISHED"]).default("PENDING"),
});

export async function upsertTranslation(ctx: Ctx, postId: string, input: unknown) {
  const data = translationSchema.parse(input);
  await assertWritable(ctx.orgId);
  await requirePost(ctx, postId);
  return db.contentTranslation.upsert({
    where: { postId_locale: { postId, locale: data.locale } },
    create: { orgId: ctx.orgId, postId, locale: data.locale, title: data.title, body: data.body, status: data.status as LocalizationStatus, translatedById: ctx.userId },
    update: { title: data.title, body: data.body, status: data.status as LocalizationStatus, translatedById: ctx.userId },
  });
}

export async function listTranslations(ctx: Ctx, postId: string) {
  await requirePost(ctx, postId);
  return db.contentTranslation.findMany({ where: { postId, orgId: ctx.orgId }, orderBy: { locale: "asc" } });
}

export async function setTranslationStatus(ctx: Ctx, id: string, status: LocalizationStatus) {
  const row = await requireOwned(await db.contentTranslation.findUnique({ where: { id } }), "Translation", ctx.orgId);
  const updated = await db.contentTranslation.update({ where: { id }, data: { status } });
  await audit(db, ctx, `translation.${status.toLowerCase()}`, undefined, row.postId, { locale: row.locale });
  return updated;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SCORE_KINDS = ["READABILITY", "SEO", "ENGAGEMENT", "BRAND_SENTIMENT", "ACCESSIBILITY"] as const;

/** Deterministic heuristic scorers — no external model calls. */
function scoreContent(kind: (typeof SCORE_KINDS)[number], text: string, meta: { hasLink?: boolean; hashtagCount?: number; brandWords?: string[] }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1;
  const avgWordsPerSentence = words.length / sentences;
  const syllables = words.reduce((a, w) => a + Math.max(1, Math.round(w.length / 3)), 0);
  switch (kind) {
    case "READABILITY": {
      const flesch = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * (syllables / Math.max(1, words.length));
      return { scoreBps: Math.max(0, Math.min(10_000, Math.round(flesch * 100))), detail: { flesch: Number(flesch.toFixed(2)), words: words.length, sentences } };
    }
    case "SEO": {
      let score = 5000;
      if (meta.hasLink) score += 1500;
      if (words.length >= 100) score += 1500;
      if (words.length >= 300) score += 1000;
      if (/(how|guide|best|why|what)/i.test(text)) score += 1000;
      return { scoreBps: Math.min(10_000, score), detail: { words: words.length, hasLink: Boolean(meta.hasLink) } };
    }
    case "ENGAGEMENT": {
      const score = 4000 + Math.min(3000, (meta.hashtagCount ?? 0) * 400) + (text.includes("?") ? 1000 : 0);
      return { scoreBps: Math.min(10_000, score), detail: { hashtags: meta.hashtagCount ?? 0 } };
    }
    case "BRAND_SENTIMENT": {
      const positive = ["love", "great", "best", "amazing", "help", "grow", "win"];
      const negative = ["bad", "worst", "hate", "fail", "problem"];
      const pos = positive.filter((w) => new RegExp(`\\b${w}`, "i").test(text)).length;
      const neg = negative.filter((w) => new RegExp(`\\b${w}`, "i").test(text)).length;
      const score = 5000 + (pos - neg) * 1000;
      return { scoreBps: Math.max(0, Math.min(10_000, score)), detail: { positive: pos, negative: neg } };
    }
    default: {
      const longWords = words.filter((w) => w.length > 15).length;
      const score = 8000 - longWords * 300 - (avgWordsPerSentence > 25 ? 1500 : 0);
      return { scoreBps: Math.max(0, Math.min(10_000, score)), detail: { longWords, avgWordsPerSentence: Number(avgWordsPerSentence.toFixed(1)) } };
    }
  }
}

export async function scoreContentPost(ctx: Ctx, postId: string, kinds?: (typeof SCORE_KINDS)[number][]) {
  const post = await requirePost(ctx, postId);
  const list = kinds?.length ? kinds : [...SCORE_KINDS];
  const results = [];
  for (const kind of list) {
    const { scoreBps, detail } = scoreContent(kind, `${post.title} ${post.body}`, { hasLink: Boolean(post.linkUrl), hashtagCount: post.hashtags.length });
    const row = await db.contentScore.upsert({
      where: { postId_kind: { postId, kind: kind as ContentScoreKind } },
      create: { orgId: ctx.orgId, postId, kind: kind as ContentScoreKind, scoreBps, detail: detail as object },
      update: { scoreBps, detail: detail as object, computedAt: new Date() },
    });
    results.push(row);
  }
  return results;
}

export async function listContentScores(ctx: Ctx, postId: string) {
  await requirePost(ctx, postId);
  return db.contentScore.findMany({ where: { postId, orgId: ctx.orgId }, orderBy: { kind: "asc" } });
}

// ---------------------------------------------------------------------------
// Universal content kinds
// ---------------------------------------------------------------------------

export const contentKindSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/),
  name: nameish,
  schema: z.record(z.string(), z.unknown()).default({}),
});

export async function upsertContentKind(ctx: Ctx, input: unknown, id?: string) {
  const data = contentKindSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (id) {
    await requireOwned(await db.contentKind.findUnique({ where: { id } }), "Content kind", ctx.orgId);
    return db.contentKind.update({ where: { id }, data: { name: data.name, mediaType: String((data.schema as { mediaType?: string }).mediaType ?? "text") } });
  }
  return db.contentKind
    .create({ data: { orgId: ctx.orgId, key: data.key, name: data.name, mediaType: String((data.schema as { mediaType?: string }).mediaType ?? "text") } })
    .catch(() => {
      throw new AppError(ErrorCodes.CONFLICT, "A content kind with this key already exists");
    });
}

export async function listContentKinds(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const [rows, total] = await Promise.all([
    db.contentKind.findMany({ where: { orgId: ctx.orgId, ...(p.q ? { name: { contains: p.q, mode: "insensitive" as const } } : {}) }, ...skipTake(p), orderBy: { key: "asc" } }),
    db.contentKind.count({ where: { orgId: ctx.orgId } }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function toggleContentKind(ctx: Ctx, id: string, active: boolean) {
  await requireOwned(await db.contentKind.findUnique({ where: { id } }), "Content kind", ctx.orgId);
  return db.contentKind.update({ where: { id }, data: { active } });
}

// ---------------------------------------------------------------------------
// Bulk scheduling helpers
// ---------------------------------------------------------------------------

export const bulkShiftSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(200),
  shiftMinutes: z.number().int().min(-10_080).max(10_080),
});

/** Shift every pending target of the given posts by a number of minutes. */
export async function bulkShiftSchedule(ctx: Ctx, input: unknown) {
  const data = bulkShiftSchema.parse(input);
  await assertWritable(ctx.orgId);
  const targets = await db.contentTarget.findMany({
    where: { orgId: ctx.orgId, postId: { in: data.postIds }, status: "PENDING" },
    select: { id: true, scheduledAt: true },
  });
  const deltaMs = data.shiftMinutes * 60_000;
  await db.$transaction(
    targets.map((t) =>
      db.contentTarget.update({ where: { id: t.id }, data: { scheduledAt: new Date(t.scheduledAt.getTime() + deltaMs) } }),
    ),
  );
  for (const id of data.postIds) {
    await emit(db, { type: "content.rescheduled", aggregateType: "CONTENT", aggregateId: id, orgId: ctx.orgId, payload: { shiftMinutes: data.shiftMinutes } });
  }
  await audit(db, ctx, "content.bulk_rescheduled", undefined, undefined, { count: targets.length, shiftMinutes: data.shiftMinutes });
  return { shifted: targets.length };
}

export const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(500),
});

/** Persist a user-defined ordering of posts via their updatedAt stamp. */
export async function reorderPosts(ctx: Ctx, input: unknown) {
  const data = reorderSchema.parse(input);
  const owned = await db.contentPost.count({ where: { id: { in: data.orderedIds }, orgId: ctx.orgId } });
  if (owned !== data.orderedIds.length) throw new AppError(ErrorCodes.VALIDATION, "All posts must belong to this workspace");
  const base = Date.now();
  await db.$transaction(
    data.orderedIds.map((id, idx) =>
      db.contentPost.update({ where: { id }, data: { updatedAt: new Date(base - idx * 1000) } }),
    ),
  );
  return { ok: true };
}

export const KIND_SCHEMA_VERSION = 1;
export const SCORE_KIND_LIST = SCORE_KINDS;
export const CONTENT_CODE_MAX = 32;
