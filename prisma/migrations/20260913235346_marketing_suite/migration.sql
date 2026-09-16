-- CreateEnum
CREATE TYPE "SocialNetwork" AS ENUM ('FACEBOOK', 'X', 'LINKEDIN', 'DEMO');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('CONNECTED', 'TOKEN_EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ContentPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContentTargetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PublishOutcome" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PixelPlatform" AS ENUM ('GOOGLE_ANALYTICS', 'META_PIXEL', 'TIKTOK_PIXEL', 'LINKEDIN_INSIGHT', 'PINTEREST_TAG', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PixelPlacement" AS ENUM ('HEAD', 'BODY_START');

-- CreateEnum
CREATE TYPE "PropertyVerification" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING_CONFIRM', 'SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "EmailCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'OPENED');

-- CreateTable
CREATE TABLE "SocialAppConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "network" "SocialNetwork" NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" JSONB NOT NULL,
    "scopes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "network" "SocialNetwork" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "profilePictureUrl" TEXT,
    "accessTokenEnc" JSONB NOT NULL,
    "refreshTokenEnc" JSONB,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthPending" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "network" "SocialNetwork" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "verifierEnc" JSONB,
    "redirectTo" TEXT,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthPending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "campaignId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "media" JSONB,
    "tags" TEXT[],
    "hashtags" TEXT[],
    "status" "ContentPostStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTarget" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ContentTargetStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "lastError" TEXT,
    "responseMeta" JSONB,

    CONSTRAINT "ContentTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPublishLog" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "outcome" "PublishOutcome" NOT NULL,
    "message" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebProperty" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'https',
    "verification" "PropertyVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "ga4MeasurementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingPixel" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "PixelPlatform" NOT NULL,
    "label" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "snippet" TEXT,
    "placement" "PixelPlacement" NOT NULL DEFAULT 'HEAD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingPixel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "doubleOptIn" BOOLEAN NOT NULL DEFAULT true,
    "welcomeSubject" TEXT,
    "welcomeBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING_CONFIRM',
    "source" TEXT,
    "subscribedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "bodyMarkdown" TEXT NOT NULL,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "status" "EmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "opensCount" INTEGER NOT NULL DEFAULT 0,
    "testSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "status" "EmailSendStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAppConfig_orgId_active_idx" ON "SocialAppConfig"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAppConfig_orgId_network_key" ON "SocialAppConfig"("orgId", "network");

-- CreateIndex
CREATE INDEX "SocialConnection_orgId_status_idx" ON "SocialConnection"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialConnection_orgId_network_externalAccountId_key" ON "SocialConnection"("orgId", "network", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthPending_stateHash_key" ON "OAuthPending"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthPending_expiresAt_idx" ON "OAuthPending"("expiresAt");

-- CreateIndex
CREATE INDEX "ContentPost_orgId_status_updatedAt_idx" ON "ContentPost"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ContentTarget_status_scheduledAt_idx" ON "ContentTarget"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ContentTarget_orgId_idx" ON "ContentTarget"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTarget_postId_connectionId_key" ON "ContentTarget"("postId", "connectionId");

-- CreateIndex
CREATE INDEX "ContentPublishLog_targetId_idx" ON "ContentPublishLog"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_code_key" ON "TrackedLink"("code");

-- CreateIndex
CREATE INDEX "TrackedLink_orgId_idx" ON "TrackedLink"("orgId");

-- CreateIndex
CREATE INDEX "WebProperty_clientId_idx" ON "WebProperty"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WebProperty_orgId_domain_key" ON "WebProperty"("orgId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingPixel_propertyId_platform_label_key" ON "TrackingPixel"("propertyId", "platform", "label");

-- CreateIndex
CREATE UNIQUE INDEX "MailingList_orgId_name_key" ON "MailingList"("orgId", "name");

-- CreateIndex
CREATE INDEX "Subscriber_orgId_status_idx" ON "Subscriber"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_listId_emailNormalized_key" ON "Subscriber"("listId", "emailNormalized");

-- CreateIndex
CREATE INDEX "EmailCampaign_orgId_status_idx" ON "EmailCampaign"("orgId", "status");

-- CreateIndex
CREATE INDEX "EmailCampaign_status_scheduledAt_idx" ON "EmailCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "EmailSend_campaignId_status_idx" ON "EmailSend"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSend_campaignId_subscriberId_key" ON "EmailSend"("campaignId", "subscriberId");

-- AddForeignKey
ALTER TABLE "SocialAppConfig" ADD CONSTRAINT "SocialAppConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConnection" ADD CONSTRAINT "SocialConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConnection" ADD CONSTRAINT "SocialConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTarget" ADD CONSTRAINT "ContentTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTarget" ADD CONSTRAINT "ContentTarget_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SocialConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTarget" ADD CONSTRAINT "ContentTarget_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPublishLog" ADD CONSTRAINT "ContentPublishLog_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ContentTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebProperty" ADD CONSTRAINT "WebProperty_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebProperty" ADD CONSTRAINT "WebProperty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPixel" ADD CONSTRAINT "TrackingPixel_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "WebProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPixel" ADD CONSTRAINT "TrackingPixel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingList" ADD CONSTRAINT "MailingList_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MailingList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "EmailCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
