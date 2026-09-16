import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { nameish, urlish } from "../schemas";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export const linkSchema = z.object({
  label: nameish,
  destination: urlish,
  campaignId: z.string().max(64).nullable().optional(),
  clientId: z.string().max(64).nullable().optional(),
  utmSource: z.string().trim().max(100).nullable().optional(),
  utmMedium: z.string().trim().max(100).nullable().optional(),
  utmCampaign: z.string().trim().max(100).nullable().optional(),
  utmTerm: z.string().trim().max(100).nullable().optional(),
  utmContent: z.string().trim().max(100).nullable().optional(),
});

export async function createLink(ctx: Ctx, input: unknown) {
  const data = linkSchema.parse(input);
  await assertWritable(ctx.orgId);
  let campaignName: string | null = null;
  if (data.campaignId) {
    const campaign = await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
    campaignName = campaign.name;
  }
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const utmCampaign = data.utmCampaign ?? campaignName;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    try {
      const link = await db.trackedLink.create({
        data: {
          orgId: ctx.orgId,
          code,
          label: data.label,
          destination: data.destination,
          campaignId: data.campaignId ?? null,
          clientId: data.clientId ?? null,
          utmSource: data.utmSource ?? null,
          utmMedium: data.utmMedium ?? (data.campaignId ? "paid" : null),
          utmCampaign,
          utmTerm: data.utmTerm ?? null,
          utmContent: data.utmContent ?? null,
          createdById: ctx.userId,
        },
      });
      await audit(db, ctx, "link.created", undefined, link.id, { code });
      return link;
    } catch (e) {
      const err = e as { code?: string };
      if (err.code !== "P2002") throw e; // unique code collision → retry
    }
  }
  throw new AppError(ErrorCodes.INTERNAL, "Could not allocate a unique short code");
}

export async function listLinks(ctx: Ctx) {
  return db.trackedLink.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { campaign: { select: { id: true, name: true } }, client: { select: { name: true } } },
    take: 200,
  });
}

export async function updateLink(ctx: Ctx, id: string, input: unknown) {
  const data = linkSchema.partial().parse(input);
  await requireOwned(await db.trackedLink.findUnique({ where: { id } }), "Tracked link", ctx.orgId);
  return db.trackedLink.update({ where: { id }, data });
}

export async function deleteLink(ctx: Ctx, id: string) {
  const link = await requireOwned(
    await db.trackedLink.findUnique({ where: { id }, include: { _count: { select: { adCreatives: true } } } }),
    "Tracked link",
    ctx.orgId,
  );
  if (link._count.adCreatives > 0) {
    throw new AppError(ErrorCodes.CONFLICT, "Link is attached to ad creatives; unlink them first");
  }
  await db.trackedLink.delete({ where: { id } });
  await audit(db, ctx, "link.deleted", undefined, id);
}

export function buildFinalUrl(link: {
  destination: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}): string {
  const url = new URL(link.destination);
  const add = (k: string, v: string | null) => {
    if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  add("utm_source", link.utmSource);
  add("utm_medium", link.utmMedium);
  add("utm_campaign", link.utmCampaign);
  add("utm_term", link.utmTerm);
  add("utm_content", link.utmContent);
  return url.toString();
}

/** Public redirect hop: validates code, counts the click, appends UTMs. */
export async function resolveAndCount(code: string): Promise<string | null> {
  const link = await db.trackedLink.findUnique({ where: { code } });
  if (!link) return null;
  await db.trackedLink.update({ where: { id: link.id }, data: { clicks: { increment: 1n } } });
  return buildFinalUrl(link);
}
