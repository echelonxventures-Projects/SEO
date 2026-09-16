-- CreateEnum
CREATE TYPE "ContentStage" AS ENUM ('IDEATION', 'RESEARCH', 'PLANNING', 'CREATION', 'REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'OPTIMIZING', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "kindId" TEXT,
ADD COLUMN     "stage" "ContentStage" NOT NULL DEFAULT 'IDEATION';

-- CreateTable
CREATE TABLE "ContentKind" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" TEXT[],
    "mediaType" TEXT NOT NULL DEFAULT 'text',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceIdentity" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "display" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "predicate" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTrigger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "eventMatch" TEXT NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 3600,
    "maxFires" INTEGER,
    "firedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerFire" (
    "triggerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetIds" TEXT[],

    CONSTRAINT "TriggerFire_pkey" PRIMARY KEY ("triggerId","eventId")
);

-- CreateTable
CREATE TABLE "CustomFieldDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTemplateStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentKind_active_sortOrder_idx" ON "ContentKind"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ContentKind_orgId_key_key" ON "ContentKind"("orgId", "key");

-- CreateIndex
CREATE INDEX "AudienceIdentity_orgId_type_idx" ON "AudienceIdentity"("orgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AudienceIdentity_memberId_type_valueHash_key" ON "AudienceIdentity"("memberId", "type", "valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_audienceId_name_key" ON "Segment"("audienceId", "name");

-- CreateIndex
CREATE INDEX "ScheduleTrigger_orgId_active_idx" ON "ScheduleTrigger"("orgId", "active");

-- CreateIndex
CREATE INDEX "CustomFieldDef_orgId_entity_active_idx" ON "CustomFieldDef"("orgId", "entity", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_orgId_entity_key_key" ON "CustomFieldDef"("orgId", "entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingStep_clientId_key_key" ON "OnboardingStep"("clientId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplateStep_orgId_key_key" ON "OnboardingTemplateStep"("orgId", "key");

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "ContentKind"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentKind" ADD CONSTRAINT "ContentKind_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceIdentity" ADD CONSTRAINT "AudienceIdentity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AudienceMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTrigger" ADD CONSTRAINT "ScheduleTrigger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTrigger" ADD CONSTRAINT "ScheduleTrigger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTrigger" ADD CONSTRAINT "ScheduleTrigger_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerFire" ADD CONSTRAINT "TriggerFire_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "ScheduleTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerFire" ADD CONSTRAINT "TriggerFire_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDef" ADD CONSTRAINT "CustomFieldDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStep" ADD CONSTRAINT "OnboardingStep_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTemplateStep" ADD CONSTRAINT "OnboardingTemplateStep_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
