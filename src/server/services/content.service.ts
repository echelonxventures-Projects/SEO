import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, urlish } from "../schemas";
import { getConnector } from "../connectors/engine";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { connectionToken } from "./social.service";
import { emit } from "../events";

const MAX_ATTEMPTS = 5;

export const postSchema = z.object({
  title: nameish,
  body: z.string().trim().min(1).max(5000),
  linkUrl: urlish.nullable().optional(),
  hashtags: z.array(z.string().trim().max(40)).max(30).default([]),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  kind: z.string().trim().max(30).default("text"),
  clientId: z.string().max(64).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  campaignId: z.string().max(64).nullable().optional(),
  targets: z
    .array(
      z.object({
        connectionId: z.string().min(1),
        scheduledAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(10),
});

async function validateTargets(ctx: Ctx, targets: Array<{ connectionId: string }>) {
  if (new Set(targets.map((t) => t.connectionId)).size !== targets.length) {
    throw new AppError(ErrorCodes.VALIDATION, "Duplicate target connection");
  }
  const conns = await db.socialConnection.findMany({
    where: { id: { in: targets.map((t) => t.connectionId) }, orgId: ctx.orgId },
  });
  if (conns.length !== targets.length) {
    throw new AppError(ErrorCodes.VALIDATION, "All targets must be connections in this workspace");
  }
  for (const c of conns) {
    if (c.status !== "CONNECTED") {
      throw new AppError(ErrorCodes.ILLEGAL_STATE, `Connection ${c.handle} is ${c.status.toLowerCase()}`);
    }
  }
  return conns;
}

function derivePostStatus(targets: Array<{ status: string }>): "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "PARTIALLY_PUBLISHED" | "FAILED" {
  if (targets.length === 0) return "SCHEDULED";
  const pub = targets.filter((t) => t.status === "PUBLISHED").length;
  const active = targets.filter((t) => t.status === "PENDING" || t.status === "PUBLISHING").length;
  const failed = targets.filter((t) => t.status === "FAILED").length;
  if (pub === targets.length) return "PUBLISHED";
  if (active > 0) return "SCHEDULED";
  if (pub > 0 && failed > 0) return "PARTIALLY_PUBLISHED";
  return "FAILED";
}

export async function createPost(ctx: Ctx, input: unknown) {
  const data = postSchema.parse(input);
  await assertWritable(ctx.orgId);
  await validateTargets(ctx, data.targets);
  if (data.projectId) await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  if (data.campaignId) await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
  const post = await db.contentPost.create({
    data: {
      orgId: ctx.orgId,
      title: data.title,
      body: data.body,
      linkUrl: data.linkUrl ?? null,
      hashtags: data.hashtags,
      tags: data.tags,
      stage: data.targets.some((t) => Date.parse(t.scheduledAt) <= Date.now()) ? "PUBLISHING" : "PLANNING",
      kindId: (await db.contentKind.findFirst({ where: { key: data.kind, OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: { orgId: { sort: "asc", nulls: "last" } } }))?.id ?? null,
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      campaignId: data.campaignId ?? null,
      createdById: ctx.userId,
      status: "SCHEDULED",
      targets: {
        create: data.targets.map((t) => ({
          connectionId: t.connectionId,
          orgId: ctx.orgId,
          scheduledAt: new Date(t.scheduledAt),
        })),
      },
    },
    include: { targets: true },
  });
  await audit(db, ctx, "content.scheduled", undefined, post.id, { targets: post.targets.length });
  return post;
}

export async function listPosts(ctx: Ctx, query: URLSearchParams) {
  const from = query.get("from");
  const to = query.get("to");
  const status = query.get("status");
  const statuses = ["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "PARTIALLY_PUBLISHED", "FAILED", "CANCELLED"];
  const where = {
    orgId: ctx.orgId,
    ...(status && statuses.includes(status) ? { status: status as never } : {}),
    ...(from || to
      ? {
          targets: {
            some: {
              scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) },
            },
          },
        }
      : {}),
    ...(query.get("q")
      ? { title: { contains: query.get("q") as string, mode: "insensitive" as const } }
      : {}),
  };
  const rows = await db.contentPost.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      targets: { include: { connection: { select: { id: true, connectorKey: true, handle: true, displayName: true } } } },
      campaign: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      kind: { select: { key: true, name: true } },
    },
  });
  return { rows, total: rows.length };
}

export async function getPost(ctx: Ctx, id: string) {
  const post = await requireOwned(
    await db.contentPost.findUnique({
      where: { id },
      include: {
        targets: {
          include: { connection: { select: { id: true, connectorKey: true, handle: true, displayName: true } }, logs: { orderBy: { at: "desc" }, take: 5 } },
          orderBy: { scheduledAt: "asc" },
        },
        campaign: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    }),
    "Content post",
    ctx.orgId,
  );
  return post;
}

export async function updatePost(ctx: Ctx, id: string, input: unknown) {
  const data = postSchema.partial().parse(input);
  const post = await requireOwned(
    await db.contentPost.findUnique({ where: { id }, include: { targets: true } }),
    "Content post",
    ctx.orgId,
  );
  if (!post.targets.every((t) => t.status === "PENDING")) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Only fully queued posts can be edited (some targets already published/failed)");
  }
  await db.$transaction(async (tx) => {
    await tx.contentPost.update({
      where: { id },
      data: {
        title: data.title,
        body: data.body,
        linkUrl: data.linkUrl,
        hashtags: data.hashtags,
        tags: data.tags,
        clientId: data.clientId,
        projectId: data.projectId,
        campaignId: data.campaignId,
      },
    });
    if (data.targets) {
      await validateTargets(ctx, data.targets);
      await tx.contentTarget.deleteMany({ where: { postId: id } });
      await tx.contentTarget.createMany({
        data: data.targets.map((t) => ({
          postId: id,
          connectionId: t.connectionId,
          orgId: ctx.orgId,
          scheduledAt: new Date(t.scheduledAt),
        })),
      });
    }
    await audit(tx, ctx, "content.updated", undefined, id);
  });
  return getPost(ctx, id);
}

export async function cancelPost(ctx: Ctx, id: string) {
  const post = await requireOwned(
    await db.contentPost.findUnique({ where: { id }, include: { targets: true } }),
    "Content post",
    ctx.orgId,
  );
  if (post.targets.some((t) => t.status === "PUBLISHED")) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Post already published to at least one channel");
  }
  await db.$transaction(async (tx) => {
    await tx.contentTarget.updateMany({ where: { postId: id, status: { not: "PUBLISHED" } }, data: { status: "SKIPPED" } });
    await tx.contentPost.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, ctx, "content.cancelled", undefined, id);
  });
}

export async function publishNow(ctx: Ctx, id: string) {
  const post = await requireOwned(await db.contentPost.findUnique({ where: { id } }), "Content post", ctx.orgId);
  await db.contentTarget.updateMany({
    where: { postId: id, status: "PENDING" },
    data: { scheduledAt: new Date() },
  });
  await audit(db, ctx, "content.publish_queued", undefined, post.id);
}

export async function retryTarget(ctx: Ctx, targetId: string) {
  const t = await requireOwned(
    await db.contentTarget.findUnique({ where: { id: targetId } }),
    "Content target",
    ctx.orgId,
  );
  if (t.status !== "FAILED") throw new AppError(ErrorCodes.ILLEGAL_STATE, `Target is ${t.status.toLowerCase()}`);
  await db.contentTarget.update({
    where: { id: targetId },
    data: { status: "PENDING", attempts: 0, lastError: null, scheduledAt: new Date() },
  });
  await audit(db, ctx, "content.target_retried", undefined, targetId);
}

/**
 * Publisher engine: atomically claims due targets, publishes through the
 * provider adapters and derives post status. Safe to run concurrently —
 * claims are compare-and-set.
 */
export async function runPublisher(limit = 10): Promise<{ published: number; failed: number }> {
  const due = await db.contentTarget.findMany({
    where: { status: "PENDING", scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: {
      connection: true,
      post: { select: { id: true, body: true, title: true, linkUrl: true, hashtags: true } },
    },
  });
  let published = 0;
  let failed = 0;
  for (const t of due) {
    // atomic claim
    const claim = await db.contentTarget.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "PUBLISHING" } });
    if (claim.count === 0) continue;
    let ok = false;
    let error: string | null = null;
    let external: { externalId: string; url?: string | null } | null = null;
    try {
      const secrets = await connectionToken(t.connection);
      const { adapter: provider } = await getConnector(t.connection.connectorKey, t.connection.orgId);
      const text = [t.post.body, t.post.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ").trim()]
        .filter(Boolean)
        .join("\n\n");
      external = await provider.publish({
        accessToken: secrets.accessToken,
        externalAccountId: t.connection.externalAccountId,
        text,
        linkUrl: t.post.linkUrl,
        apiBase: secrets.apiBase,
        headers: secrets.headers,
      });
      ok = true;
    } catch (e) {
      error = (e instanceof Error ? e.message : "publish failed").slice(0, 500);
    }
    await db.$transaction(async (tx) => {
      if (ok && external) {
        await tx.contentTarget.update({
          where: { id: t.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            externalPostId: external.externalId,
            externalUrl: external.url ?? null,
            lastError: null,
            responseMeta: { externalId: external.externalId } as object,
          },
        });
        published++;
      } else {
        const attempts = t.attempts + 1;
        await tx.contentTarget.update({
          where: { id: t.id },
          data: {
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            attempts,
            lastError: error,
            ...(attempts < MAX_ATTEMPTS ? { scheduledAt: new Date(Date.now() + attempts * 60_000) } : {}),
          },
        });
        if (attempts >= MAX_ATTEMPTS) failed++;
      }
      await tx.contentPublishLog.create({
        data: { targetId: t.id, outcome: ok ? "SUCCESS" : "FAILED", message: error },
      });
      if (ok) {
        await emit(tx, { type: "content.published", aggregateType: "CONTENT_POST", aggregateId: t.post.id, orgId: t.orgId, payload: { connector: t.connection.connectorKey, url: external?.url ?? null } });
      } else {
        await emit(tx, { type: "content.failed", aggregateType: "CONTENT_POST", aggregateId: t.post.id, orgId: t.orgId, payload: { error } });
      }
      const targets = await tx.contentTarget.findMany({ where: { postId: t.post.id }, select: { status: true } });
      await tx.contentPost.update({ where: { id: t.post.id }, data: { status: derivePostStatus(targets) } });
    });
  }
  return { published, failed };
}


// ---------------------------------------------------------------------------
// §6 Content lifecycle stages + kind registry
// ---------------------------------------------------------------------------

const STAGE_FLOW: Record<string, string[]> = {
  IDEATION: ["RESEARCH", "PLANNING", "CREATION", "ARCHIVED"],
  RESEARCH: ["PLANNING", "IDEATION", "ARCHIVED"],
  PLANNING: ["CREATION", "RESEARCH", "ARCHIVED"],
  CREATION: ["REVIEW", "PLANNING", "ARCHIVED"],
  REVIEW: ["APPROVED", "CREATION", "ARCHIVED"],
  APPROVED: ["PUBLISHING", "REVIEW", "ARCHIVED"],
  PUBLISHING: ["PUBLISHED", "REVIEW"],
  PUBLISHED: ["OPTIMIZING", "ARCHIVED"],
  OPTIMIZING: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["IDEATION"],
};

export async function moveStage(ctx: Ctx, postId: string, to: string) {
  const post = await requireOwned(await db.contentPost.findUnique({ where: { id: postId } }), "Content post", ctx.orgId);
  if (!(STAGE_FLOW[post.stage] ?? []).includes(to)) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, `Cannot move ${post.stage.toLowerCase()} → ${to.toLowerCase()} (allowed: ${(STAGE_FLOW[post.stage] ?? []).join(", ") || "none"})`);
  }
  const updated = await db.contentPost.update({ where: { id: postId }, data: { stage: to as never } });
  await audit(db, ctx, "content.stage_changed", undefined, postId, { to });
  await emit(db, { type: "content.stage_changed", aggregateType: "CONTENT_POST", aggregateId: postId, orgId: ctx.orgId, payload: { stage: to, title: post.title } });
  return updated;
}

export function allowedStages(current: string): string[] {
  return STAGE_FLOW[current] ?? [];
}

export const kindSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/),
  name: nameish,
  mediaType: z.enum(["text", "image", "video", "audio", "interactive"]).default("text"),
  capabilities: z.array(z.string().trim().max(30)).max(10).default(["social", "blog", "email"]),
});

export async function listKinds(ctx: Ctx) {
  const rows = await db.contentKind.findMany({ where: { active: true, OR: [{ orgId: ctx.orgId }, { orgId: null }] }, orderBy: { sortOrder: "asc" } });
  const merged = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = merged.get(r.key);
    if (!prev || (r.orgId !== null && prev.orgId === null)) merged.set(r.key, r);
  }
  return [...merged.values()];
}

export async function createKind(ctx: Ctx, input: unknown) {
  const data = kindSchema.parse(input);
  const row = await db.contentKind.create({
    data: { orgId: ctx.orgId, key: data.key, name: data.name, mediaType: data.mediaType, capabilities: data.capabilities, sortOrder: 100 },
  }).catch(() => { throw new AppError(ErrorCodes.CONFLICT, `kind "${data.key}" already defined`); });
  await audit(db, ctx, "contentkind.created", undefined, row.id, { key: row.key });
  return row;
}
