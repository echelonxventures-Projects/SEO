import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { encryptSecret } from "../crypto";
import { nameish, urlish, codeish } from "../schemas";
import { FeatureCode, type AiModelConfig } from "@/generated/prisma/client";
import type { Ctx } from "./common";
import { assertWritable, audit, requireOwned } from "./common";
import { aiCredentialAad, aiRouting, resolveAiCandidates, type AiCapability } from "../ai/registry";

// ---------------------------------------------------------------------------
// AI model configs
// ---------------------------------------------------------------------------

export const aiConfigSchema = z.object({
  providerCode: z.enum(["openai", "anthropic", "demo"]),
  label: nameish,
  baseUrl: urlish.nullable().optional(),
  apiKey: z.string().trim().min(1).max(400),
  textModel: z.string().trim().max(80).default("gpt-4o-mini"),
  imageModel: z.string().trim().max(80).default("gpt-image-1"),
  audioModel: z.string().trim().max(80).default("tts-1"),
  defaultVoice: z.string().trim().max(40).default("alloy"),
  scope: z.enum(["ORGANIZATION", "PLATFORM"]).default("ORGANIZATION"),
  priority: z.number().int().min(1).max(1000).default(100),
  requiredFeature: z.nativeEnum(FeatureCode).nullable().default(null),
});

export async function listAiConfigs(ctx: Ctx) {
  return db.aiModelConfig.findMany({
    where: { OR: [{ orgId: ctx.orgId }, ...(ctx.viewer.isPlatformAdmin ? [{ orgId: null }] : [])] },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      providerCode: true,
      label: true,
      baseUrl: true,
      textModel: true,
      imageModel: true,
      audioModel: true,
      defaultVoice: true,
      priority: true,
      requiredFeature: true,
      active: true,
      orgId: true,
      updatedAt: true,
    },
  });
}

export async function upsertAiConfig(ctx: Ctx, input: unknown) {
  const data = aiConfigSchema.parse(input);
  if (data.scope === "PLATFORM" && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform AI configs require platform access");
  }
  const orgId = data.scope === "PLATFORM" ? null : ctx.orgId;
  const keyJson = JSON.stringify({ apiKey: data.apiKey });
  const existing = await db.aiModelConfig.findFirst({ where: { orgId, providerCode: data.providerCode } });
  if (existing) {
    const updated = await db.aiModelConfig.update({
      where: { id: existing.id },
      data: {
        label: data.label,
        baseUrl: data.baseUrl ?? null,
        textModel: data.textModel,
        imageModel: data.imageModel,
        audioModel: data.audioModel,
        defaultVoice: data.defaultVoice,
        priority: data.priority,
        requiredFeature: data.requiredFeature,
        apiKeyEnc: encryptSecret(keyJson, aiCredentialAad(existing)),
      },
    });
    await audit(db, ctx, "ai.config_updated", undefined, updated.id, { provider: data.providerCode });
    return { id: updated.id };
  }
  // The AAD binds the ciphertext to the row id, so create once with a
  // placeholder then re-encrypt against the final identity.
  const created = await db.aiModelConfig.create({
    data: {
      orgId,
      providerCode: data.providerCode,
      label: data.label,
      baseUrl: data.baseUrl ?? null,
      textModel: data.textModel,
      imageModel: data.imageModel,
      audioModel: data.audioModel,
      defaultVoice: data.defaultVoice,
      priority: data.priority,
      requiredFeature: data.requiredFeature,
      apiKeyEnc: encryptSecret(keyJson, "ai:pending"),
      active: false,
    },
  });
  await db.aiModelConfig.update({
    where: { id: created.id },
    data: { apiKeyEnc: encryptSecret(keyJson, aiCredentialAad(created)) },
  });
  await audit(db, ctx, "ai.config_created", undefined, created.id, { provider: data.providerCode });
  return { id: created.id };
}

export async function activateAiConfig(ctx: Ctx, id: string, active: boolean) {
  const cfg = await requireOwned(await db.aiModelConfig.findUnique({ where: { id } }), "AI config", ctx.orgId);
  if (cfg.orgId === null && !ctx.viewer.isPlatformAdmin) {
    throw new AppError(ErrorCodes.FORBIDDEN, "Platform AI configs require platform access");
  }
  await db.aiModelConfig.update({ where: { id }, data: { active } });
  await audit(db, ctx, active ? "ai.config_activated" : "ai.config_deactivated", undefined, id);
}

// ---------------------------------------------------------------------------
// Brand voice
// ---------------------------------------------------------------------------

export const brandVoiceSchema = z.object({
  name: nameish,
  clientId: z.string().max(64).nullable().optional(),
  tone: z.string().trim().min(3).max(300),
  audience: z.string().trim().min(3).max(500),
  vocabularyDo: z.array(z.string().trim().max(60)).max(60).default([]),
  vocabularyDont: z.array(z.string().trim().max(60)).max(60).default([]),
  bannedClaims: z.string().trim().max(1000).nullable().optional(),
  sampleText: z.string().trim().max(5000).nullable().optional(),
  isDefault: z.boolean().default(false),
});

export async function listVoices(ctx: Ctx) {
  return db.brandVoice.findMany({
    where: { orgId: ctx.orgId },
    include: { client: { select: { id: true, name: true } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function upsertVoice(ctx: Ctx, id: string | null, input: unknown) {
  const data = brandVoiceSchema.parse(input);
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  if (data.isDefault) {
    await db.brandVoice.updateMany({ where: { orgId: ctx.orgId, isDefault: true }, data: { isDefault: false } });
  }
  if (id) {
    await requireOwned(await db.brandVoice.findUnique({ where: { id } }), "Brand voice", ctx.orgId);
    const v = await db.brandVoice.update({ where: { id }, data });
    await audit(db, ctx, "brandvoice.updated", undefined, id);
    return v;
  }
  const v = await db.brandVoice.create({ data: { orgId: ctx.orgId, ...data } });
  await audit(db, ctx, "brandvoice.created", undefined, v.id);
  return v;
}

export async function deleteVoice(ctx: Ctx, id: string) {
  await requireOwned(await db.brandVoice.findUnique({ where: { id } }), "Brand voice", ctx.orgId);
  await db.brandVoice.delete({ where: { id } });
  await audit(db, ctx, "brandvoice.deleted", undefined, id);
}

// ---------------------------------------------------------------------------
// Prompt templates (DB-driven; org overrides beat global)
// ---------------------------------------------------------------------------

export async function listTemplates(ctx: Ctx) {
  return db.promptTemplate.findMany({
    where: { OR: [{ orgId: ctx.orgId }, { orgId: null }] },
    orderBy: [{ kind: "asc" }, { key: "asc" }],
  });
}

export async function upsertTemplate(ctx: Ctx, id: string | null, input: unknown) {
  const data = z
    .object({
      key: codeish,
      kind: z.enum(["BLOG_OUTLINE", "BLOG_DRAFT", "AD_COPY", "SOCIAL_CAPTION", "VOICEOVER_SCRIPT", "IMAGE_PROMPT", "NEWSLETTER", "KEYWORD_IDEAS"]),
      title: nameish,
      body: z.string().min(20).max(20000),
      modelHint: z.string().trim().max(80).nullable().optional(),
    })
    .parse(input);
  if (id) {
    const t = await requireOwned(await db.promptTemplate.findUnique({ where: { id } }), "Template", ctx.orgId);
    if (t.orgId === null && !ctx.viewer.isPlatformAdmin) {
      throw new AppError(ErrorCodes.FORBIDDEN, "Global templates require platform access");
    }
    return db.promptTemplate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }
  return db.promptTemplate.create({ data: { orgId: ctx.orgId, ...data } });
}

async function getTemplate(tx: typeof db, orgId: string, key: string) {
  const orgT = await tx.promptTemplate.findFirst({ where: { orgId, key, active: true } });
  if (orgT) return orgT;
  const globalT = await tx.promptTemplate.findFirst({ where: { orgId: null, key, active: true } });
  if (!globalT) throw new AppError(ErrorCodes.NOT_FOUND, `Prompt template "${key}" is missing — re-run the seed or add it in Settings.`);
  return globalT;
}

function render(vars: Record<string, string>, body: string): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

type VoiceBlock = { text: string; audience: string | null };

async function voiceBlock(orgId: string, clientId?: string | null): Promise<VoiceBlock> {
  const voice =
    (clientId ? await db.brandVoice.findFirst({ where: { orgId, clientId } }) : null) ??
    (await db.brandVoice.findFirst({ where: { orgId, isDefault: true } })) ??
    (await db.brandVoice.findFirst({ where: { orgId } }));
  if (!voice) return { text: "Brand voice: (not configured — use a neutral professional tone)", audience: null };
  const parts = [
    `Tone: ${voice.tone}`,
    `Audience: ${voice.audience}`,
    voice.vocabularyDo.length ? `Preferred words: ${voice.vocabularyDo.join(", ")}` : "",
    voice.vocabularyDont.length ? `Avoid words: ${voice.vocabularyDont.join(", ")}` : "",
    voice.bannedClaims ? `Never claim: ${voice.bannedClaims}` : "",
  ].filter(Boolean);
  return { text: `Brand voice (follow exactly):\n${parts.join("\n")}`, audience: voice.audience };
}

// ---------------------------------------------------------------------------
// Generation jobs
// ---------------------------------------------------------------------------

export const generateSchema = z.object({
  kind: z.enum(["BLOG_OUTLINE", "BLOG_DRAFT", "AD_COPY", "SOCIAL_CAPTION", "VOICEOVER_SCRIPT", "IMAGE", "NEWSLETTER", "KEYWORD_IDEAS"]),
  topic: z.string().trim().min(2).max(300),
  clientId: z.string().max(64).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  campaignId: z.string().max(64).nullable().optional(),
  keywords: z.string().trim().max(500).default(""),
  platform: z.string().trim().max(40).default("blog"),
  variants: z.number().int().min(1).max(6).default(3),
  seconds: z.number().int().min(10).max(120).default(30),
  destination: z.string().trim().max(500).default(""),
});

const TEMPLATE_BY_KIND: Record<string, string> = {
  BLOG_OUTLINE: "blog_outline",
  BLOG_DRAFT: "blog_draft",
  AD_COPY: "ad_copy",
  SOCIAL_CAPTION: "social_caption",
  VOICEOVER_SCRIPT: "voiceover_script",
  IMAGE: "image_prompt",
  NEWSLETTER: "newsletter",
  KEYWORD_IDEAS: "keyword_ideas",
};

export async function createGenerationJob(ctx: Ctx, input: unknown) {
  const data = generateSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.clientId) await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });

  const templateKey = TEMPLATE_BY_KIND[data.kind];
  const template = await getTemplate(db, ctx.orgId, templateKey);
  const voice = await voiceBlock(ctx.orgId, data.clientId ?? null);
  const client = data.clientId ? await db.client.findUnique({ where: { id: data.clientId }, select: { name: true } }) : null;
  const campaign = data.campaignId ? await db.campaign.findUnique({ where: { id: data.campaignId }, select: { name: true } }) : null;

  const vars: Record<string, string> = {
    topic: data.topic,
    audience: voice.audience ?? "busy decision-makers",
    keywords: data.keywords || data.topic,
    campaignName: campaign?.name ?? data.topic,
    platform: data.platform,
    destination: data.destination,
    tone: voice.audience ? "per brand voice" : "professional",
    length: `${data.seconds} seconds`,
    variants: String(data.variants),
    brand: org.name,
    clientName: client?.name ?? org.name,
  };
  const rendered = render(vars, template.body);
  const capability: AiCapability = data.kind === "IMAGE" ? "image" : "text";
  const candidates = await resolveAiCandidates(ctx.orgId, capability);

  const job = await db.generationJob.create({
    data: {
      orgId: ctx.orgId,
      kind: data.kind,
      status: "RUNNING",
      provider: candidates[0].cfg.providerCode === "openai" ? "OPENAI" : candidates[0].cfg.providerCode === "anthropic" ? "ANTHROPIC" : candidates[0].cfg.providerCode === "google" ? "GOOGLE" : "DEMO",
      modelCode: candidates[0].cfg.textModel,
      templateKey,
      input: { ...data } as never,
      createdById: ctx.userId,
    },
  });

  type Attempt = {
    provider: "OPENAI" | "ANTHROPIC" | "GOOGLE" | "DEMO";
    configId: string;
    model: string;
    outputText: string;
    outputJson: unknown;
    outputUrl: string | null;
    tokensIn: number;
    tokensOut: number;
  };
  const providerTag = (code: string): Attempt["provider"] =>
    code === "openai" ? "OPENAI" : code === "anthropic" ? "ANTHROPIC" : code === "google" ? "GOOGLE" : "DEMO";

  let attempt: Attempt | null = null;
  let lastError: string | null = null;
  for (const resolved of candidates) {
    try {
      let outputText: string;
      let outputJson: unknown = null;
      let outputUrl: string | null = null;
      let tokensIn = 0;
      let tokensOut = 0;

      if (data.kind === "IMAGE") {
        const promptRes = await resolved.adapter.text(resolved.cfg, resolved.apiKey, {
          system: "You are an advertising art director. Reply with ONLY the image prompt.",
          user: `TASK: IMAGE_PROMPT\nTopic: ${data.topic}\nPlatform: ${data.platform}\n${voice.text}\n${rendered}`,
          maxTokens: 300,
          temperature: 0.8,
        });
        const img = await resolved.adapter.image!(resolved.cfg, resolved.apiKey, {
          prompt: promptRes.text.trim() || data.topic,
          size: "1536x1024",
        });
        outputText = promptRes.text.trim();
        outputUrl = img.url;
        tokensIn = promptRes.tokensIn;
        tokensOut = promptRes.tokensOut;
      } else if (data.kind === "VOICEOVER_SCRIPT") {
        const res = await resolved.adapter.text(resolved.cfg, resolved.apiKey, {
          system: "You are a direct-response scriptwriter. Follow the task and brand voice exactly.",
          user: `TASK: VOICEOVER_SCRIPT\nTopic: ${data.topic}\nCampaign: ${vars.campaignName}\nAudience: ${vars.audience}\nSeconds: ${data.seconds}\n${voice.text}\n${rendered}`,
          maxTokens: 1200,
          temperature: 0.8,
        });
        outputText = res.text;
        tokensIn = res.tokensIn;
        tokensOut = res.tokensOut;
        if (resolved.adapter.audio) {
          try {
            const clean = outputText.replace(/\[[^\]]+\]/g, "").replace(/^#.*$/gm, "").trim();
            const audio = await resolved.adapter.audio(resolved.cfg, resolved.apiKey, {
              text: clean,
              voice: resolved.cfg.defaultVoice,
            });
            outputUrl = audio.url;
          } catch {
            outputUrl = null;
          }
        }
      } else {
        const res = await resolved.adapter.text(resolved.cfg, resolved.apiKey, {
          system: `You are a senior ${data.kind === "AD_COPY" ? "performance copywriter" : "content strategist"}. Follow the task format and brand voice exactly. Plain text/markdown only.`,
          user: `TASK: ${data.kind}\nTopic: ${data.topic}\nKeywords: ${vars.keywords}\nPlatform: ${data.platform}\nCampaign: ${vars.campaignName}\nAudience: ${vars.audience}\nTone: ${vars.tone}\nVariants: ${data.variants}\nDestination: ${data.destination}\n${voice.text}\n${rendered}`,
          maxTokens: 2400,
          temperature: 0.85,
        });
        outputText = res.text;
        if (data.kind === "AD_COPY") {
          try {
            const parsed = JSON.parse(res.text.replace(/^```json?/i, "").replace(/```$/m, "").trim());
            if (Array.isArray(parsed.ads)) outputJson = parsed;
          } catch {
            outputJson = null;
          }
        }
        tokensIn = res.tokensIn;
        tokensOut = res.tokensOut;
      }
      attempt = {
        provider: providerTag(resolved.adapter.code),
        configId: resolved.cfg.id,
        model: resolved.adapter.code === "demo" ? "demo-engine" : resolved.cfg.textModel,
        outputText,
        outputJson,
        outputUrl,
        tokensIn,
        tokensOut,
      };
      break;
    } catch (e) {
      lastError = (e instanceof Error ? e.message : "provider failed").slice(0, 400);
      continue; // routing: fall through to the next eligible candidate
    }
  }

  if (!attempt) {
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: `All eligible providers failed — ${lastError ?? "no candidates"}`, finishedAt: new Date() },
    });
    throw new AppError(ErrorCodes.GATEWAY_ERROR, "Generation failed on every available provider", lastError);
  }

  try {
    const done = await db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        provider: attempt.provider,
        modelCode: attempt.model,
        outputText: attempt.outputText,
        outputJson: attempt.outputJson as never,
        outputUrl: attempt.outputUrl,
        tokensIn: attempt.tokensIn,
        tokensOut: attempt.tokensOut,
        finishedAt: new Date(),
      },
    });
    await audit(db, ctx, "ai.job_succeeded", undefined, job.id, {
      kind: data.kind,
      provider: done.provider,
      configId: attempt.configId,
    });
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generation failed";
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: msg.slice(0, 500), finishedAt: new Date() },
    });
    throw new AppError(ErrorCodes.INTERNAL, "Could not store generation output");
  }
}

/** Routing table for the settings UI: attempt order + eligibility + reasons. */
export async function studioRouting(ctx: Ctx, capability: "text" | "image" | "audio" = "text") {
  const { rows } = await aiRouting(ctx.orgId, capability);
  return { capability, rows };
}

export async function listJobs(ctx: Ctx) {
  return db.generationJob.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { createdBy: { select: { name: true } } },
  });
}

export async function getJob(ctx: Ctx, id: string) {
  return requireOwned(await db.generationJob.findUnique({ where: { id } }), "Generation job", ctx.orgId);
}

// ---------------------------------------------------------------------------
// Blog posts (studio output → owned content)
// ---------------------------------------------------------------------------

export const blogSchema = z.object({
  title: z.string().trim().min(3).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,120}$/).optional(),
  metaDescription: z.string().trim().max(300).nullable().optional(),
  keywords: z.array(z.string().trim().max(80)).max(20).default([]),
  bodyMarkdown: z.string().min(20).max(120_000),
  clientId: z.string().max(64).nullable().optional(),
  projectId: z.string().max(64).nullable().optional(),
  jobId: z.string().max(64).nullable().optional(),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || `post-${Date.now().toString(36)}`;
}

function readingMinutes(md: string): number {
  const words = md.split(/\s+/).length;
  return Math.max(1, Math.round(words / 225));
}

export async function saveBlogFromJob(ctx: Ctx, input: unknown) {
  const data = blogSchema.parse(input);
  await assertWritable(ctx.orgId);
  if (data.jobId) await getJob(ctx, data.jobId);
  const baseSlug = data.slug ?? slugify(data.title);
  let slug = baseSlug;
  for (let n = 2; await db.blogPost.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug } } }); n++) {
    slug = `${baseSlug}-${n}`;
  }
  const post = await db.blogPost.create({
    data: {
      orgId: ctx.orgId,
      title: data.title,
      slug,
      metaDescription: data.metaDescription ?? null,
      keywords: data.keywords,
      bodyMarkdown: data.bodyMarkdown,
      readingMinutes: readingMinutes(data.bodyMarkdown),
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      jobId: data.jobId ?? null,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "blog.created", undefined, post.id, { title: post.title });
  return post;
}

export async function listBlogs(ctx: Ctx) {
  return db.blogPost.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { updatedAt: "desc" },
    include: { client: { select: { name: true } }, createdBy: { select: { name: true } } },
    take: 100,
  });
}

export async function getBlog(ctx: Ctx, id: string) {
  return requireOwned(await db.blogPost.findUnique({ where: { id }, include: { job: true } }), "Blog post", ctx.orgId);
}

export async function updateBlog(ctx: Ctx, id: string, input: unknown) {
  const data = blogSchema.partial().extend({ status: z.enum(["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"]).optional() }).parse(input);
  await requireOwned(await db.blogPost.findUnique({ where: { id } }), "Blog post", ctx.orgId);
  const post = await db.blogPost.update({
    where: { id },
    data: {
      title: data.title,
      slug: data.slug,
      metaDescription: data.metaDescription,
      keywords: data.keywords,
      bodyMarkdown: data.bodyMarkdown,
      status: data.status,
      publishedAt: data.status === "PUBLISHED" ? new Date() : undefined,
      readingMinutes: data.bodyMarkdown ? readingMinutes(data.bodyMarkdown) : undefined,
    },
  });
  await audit(db, ctx, "blog.updated", undefined, id, { status: data.status });
  return post;
}

export async function deleteBlog(ctx: Ctx, id: string) {
  const b = await requireOwned(await db.blogPost.findUnique({ where: { id } }), "Blog post", ctx.orgId);
  if (b.status === "PUBLISHED") {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "Archive the post instead of deleting published content");
  }
  await db.blogPost.delete({ where: { id } });
  await audit(db, ctx, "blog.deleted", undefined, id);
}

// ---------------------------------------------------------------------------
// Ad creatives
// ---------------------------------------------------------------------------

export const adCreativeSchema = z.object({
  campaignId: z.string().min(1),
  platform: z.enum(["GOOGLE_SEARCH", "GOOGLE_DISPLAY", "META", "LINKEDIN", "YOUTUBE"]),
  headline: z.string().trim().min(3).max(90),
  description: z.string().trim().max(150).nullable().optional(),
  primaryText: z.string().trim().max(1250).nullable().optional(),
  callToAction: z.string().trim().max(30).nullable().optional(),
  destinationLinkId: z.string().max(64).nullable().optional(),
  jobId: z.string().max(64).nullable().optional(),
  assetUrl: z.string().trim().max(2000).nullable().optional(),
  voiceoverScript: z.string().trim().max(5000).nullable().optional(),
});

export async function createAdCreative(ctx: Ctx, input: unknown) {
  const data = adCreativeSchema.parse(input);
  await assertWritable(ctx.orgId);
  const campaign = await requireOwned(await db.campaign.findUnique({ where: { id: data.campaignId } }), "Campaign", ctx.orgId);
  if (data.destinationLinkId) await requireOwned(await db.trackedLink.findUnique({ where: { id: data.destinationLinkId } }), "Tracked link", ctx.orgId);
  const variant = await db.adCreative.count({ where: { campaignId: campaign.id, platform: data.platform } });
  const creative = await db.adCreative.create({
    data: {
      orgId: ctx.orgId,
      campaignId: data.campaignId,
      platform: data.platform,
      variant: variant + 1,
      headline: data.headline,
      description: data.description ?? null,
      primaryText: data.primaryText ?? null,
      callToAction: data.callToAction ?? null,
      destinationLinkId: data.destinationLinkId ?? null,
      jobId: data.jobId ?? null,
      assetUrl: data.assetUrl ?? null,
      voiceoverScript: data.voiceoverScript ?? null,
      createdById: ctx.userId,
    },
  });
  await audit(db, ctx, "creative.created", "CAMPAIGN", data.campaignId, { platform: data.platform });
  return creative;
}

export async function listAdCreatives(ctx: Ctx, campaignId?: string) {
  return db.adCreative.findMany({
    where: { orgId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { campaign: { select: { id: true, name: true } }, destination: { select: { code: true, label: true } } },
    take: 100,
  });
}

export async function updateAdCreativeStatus(ctx: Ctx, id: string, status: "DRAFT" | "APPROVED" | "LIVE" | "PAUSED" | "ARCHIVED") {
  await requireOwned(await db.adCreative.findUnique({ where: { id } }), "Ad creative", ctx.orgId);
  const c = await db.adCreative.update({ where: { id }, data: { status } });
  await audit(db, ctx, `creative.${status.toLowerCase()}`, "CAMPAIGN", c.campaignId, { id });
  return c;
}
