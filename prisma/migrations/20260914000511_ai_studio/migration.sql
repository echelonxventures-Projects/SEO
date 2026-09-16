-- CreateEnum
CREATE TYPE "AiModelKind" AS ENUM ('TEXT', 'IMAGE', 'AUDIO');

-- CreateEnum
CREATE TYPE "PromptKind" AS ENUM ('BLOG_OUTLINE', 'BLOG_DRAFT', 'AD_COPY', 'SOCIAL_CAPTION', 'VOICEOVER_SCRIPT', 'IMAGE_PROMPT', 'NEWSLETTER', 'KEYWORD_IDEAS');

-- CreateEnum
CREATE TYPE "GenerationKind" AS ENUM ('BLOG_OUTLINE', 'BLOG_DRAFT', 'AD_COPY', 'SOCIAL_CAPTION', 'VOICEOVER_SCRIPT', 'IMAGE', 'NEWSLETTER', 'KEYWORD_IDEAS');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'DEMO');

-- CreateEnum
CREATE TYPE "BlogStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('GOOGLE_SEARCH', 'GOOGLE_DISPLAY', 'META', 'LINKEDIN', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('DRAFT', 'APPROVED', 'LIVE', 'PAUSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "providerCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" JSONB NOT NULL,
    "textModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "imageModel" TEXT NOT NULL DEFAULT 'gpt-image-1',
    "audioModel" TEXT NOT NULL DEFAULT 'tts-1',
    "defaultVoice" TEXT NOT NULL DEFAULT 'alloy',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "kind" "PromptKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "modelHint" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandVoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "vocabularyDo" TEXT[],
    "vocabularyDont" TEXT[],
    "bannedClaims" TEXT,
    "sampleText" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "GenerationKind" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "AiProvider" NOT NULL,
    "modelCode" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "outputText" TEXT,
    "outputJson" JSONB,
    "outputUrl" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "jobId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "metaDescription" TEXT,
    "keywords" TEXT[],
    "outline" JSONB,
    "bodyMarkdown" TEXT NOT NULL,
    "status" "BlogStatus" NOT NULL DEFAULT 'DRAFT',
    "readingMinutes" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "jobId" TEXT,
    "platform" "AdPlatform" NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
    "variant" INTEGER NOT NULL DEFAULT 1,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "primaryText" TEXT,
    "callToAction" TEXT,
    "destinationLinkId" TEXT,
    "assetUrl" TEXT,
    "voiceoverScript" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiModelConfig_active_idx" ON "AiModelConfig"("active");

-- CreateIndex
CREATE INDEX "AiModelConfig_orgId_idx" ON "AiModelConfig"("orgId");

-- CreateIndex
CREATE INDEX "PromptTemplate_kind_active_idx" ON "PromptTemplate"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_orgId_key_key" ON "PromptTemplate"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BrandVoice_orgId_name_key" ON "BrandVoice"("orgId", "name");

-- CreateIndex
CREATE INDEX "GenerationJob_orgId_kind_status_idx" ON "GenerationJob"("orgId", "kind", "status");

-- CreateIndex
CREATE INDEX "BlogPost_orgId_status_idx" ON "BlogPost"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_orgId_slug_key" ON "BlogPost"("orgId", "slug");

-- CreateIndex
CREATE INDEX "AdCreative_campaignId_status_idx" ON "AdCreative"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "AiModelConfig" ADD CONSTRAINT "AiModelConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_destinationLinkId_fkey" FOREIGN KEY ("destinationLinkId") REFERENCES "TrackedLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
