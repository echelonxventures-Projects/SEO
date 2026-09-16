-- New enums
CREATE TYPE "ChannelKind" AS ENUM ('SEARCH','SOCIAL','DISPLAY','VIDEO','EMAIL','WHATSAPP','SMS','AFFILIATE','ORGANIC','DIRECT_MAIL','MARKETPLACE');
CREATE TYPE "ChannelCostModel" AS ENUM ('CPC','CPM','CPA','FLAT','FREE');
CREATE TYPE "AudienceKind" AS ENUM ('CUSTOMER_LIST','PROSPECT_LIST','WEBSITE_VISITORS','SOCIAL_FOLLOWERS','EVENT_ATTENDEES','LOOKALIKE_SEED','SEGMENT');
CREATE TYPE "AudienceSource" AS ENUM ('CSV_UPLOAD','MANUAL','MAILING_LIST_REF','FORM_IMPORT');
CREATE TYPE "AudienceStatus" AS ENUM ('DRAFT','ACTIVE','ARCHIVED');
CREATE TYPE "ConsentStatus" AS ENUM ('OPT_IN','IMPORTED_LEGACY','EXPIRED');
CREATE TYPE "FlightStatus" AS ENUM ('DRAFT','APPROVED','LIVE','PAUSED','ENDED','CANCELLED');
CREATE TYPE "ConnectorProtocol" AS ENUM ('OAUTH2_CODE','OAUTH2_PKCE','BUILTIN');

-- New tables
CREATE TABLE "Channel" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ChannelKind" NOT NULL,
  "description" TEXT,
  "costModel" "ChannelCostModel" NOT NULL DEFAULT 'CPC',
  "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "requiresConnection" BOOLEAN NOT NULL DEFAULT false,
  "connectorKey" TEXT,
  "utmMedium" TEXT NOT NULL DEFAULT 'paid',
  "budgetCapMinor" BIGINT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Channel_orgId_code_key" ON "Channel"("orgId","code");
CREATE INDEX "Channel_active_sortOrder_idx" ON "Channel"("active","sortOrder");

CREATE TABLE "Audience" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "clientId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" "AudienceKind" NOT NULL DEFAULT 'CUSTOMER_LIST',
  "source" "AudienceSource" NOT NULL DEFAULT 'MANUAL',
  "status" "AudienceStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceListId" TEXT,
  "criteria" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Audience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Audience_orgId_name_key" ON "Audience"("orgId","name");
CREATE INDEX "Audience_orgId_status_idx" ON "Audience"("orgId","status");

CREATE TABLE "AudienceMember" (
  "id" TEXT NOT NULL,
  "audienceId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "email" TEXT,
  "emailNormalized" TEXT,
  "phone" TEXT,
  "name" TEXT,
  "company" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "consent" "ConsentStatus" NOT NULL DEFAULT 'IMPORTED_LEGACY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudienceMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AudienceMember_audienceId_identityKey_key" ON "AudienceMember"("audienceId","identityKey");
CREATE INDEX "AudienceMember_orgId_idx" ON "AudienceMember"("orgId");

CREATE TABLE "CampaignFlight" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "audienceId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "budgetMinor" BIGINT,
  "cadence" JSONB,
  "status" "FlightStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "slotsGenerated" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignFlight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CampaignFlight_orgId_startsAt_idx" ON "CampaignFlight"("orgId","startsAt");
CREATE INDEX "CampaignFlight_campaignId_idx" ON "CampaignFlight"("campaignId");
CREATE INDEX "CampaignFlight_status_startsAt_endsAt_idx" ON "CampaignFlight"("status","startsAt","endsAt");

CREATE TABLE "ConnectorTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "protocol" "ConnectorProtocol" NOT NULL DEFAULT 'OAUTH2_CODE',
  "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "authorizeUrl" TEXT,
  "tokenUrl" TEXT,
  "apiBase" TEXT,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "config" JSONB NOT NULL,
  "docsUrl" TEXT,
  "icon" TEXT,
  "builtin" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectorTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConnectorTemplate_orgId_key_key" ON "ConnectorTemplate"("orgId","key");
CREATE INDEX "ConnectorTemplate_active_sortOrder_idx" ON "ConnectorTemplate"("active","sortOrder");

-- Campaign: nullable legacy channel + new refs
ALTER TABLE "Campaign" ALTER COLUMN "channelId" DROP NOT NULL;
ALTER TABLE "Campaign" ADD COLUMN "mediaChannelId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "audienceId" TEXT;

-- Connector keys: backfill then drop enum columns
ALTER TABLE "SocialConnection" ADD COLUMN "connectorKey" TEXT;
UPDATE "SocialConnection" SET "connectorKey" = CASE WHEN "network"::text = 'X' THEN 'x' ELSE lower("network"::text) END;
ALTER TABLE "SocialConnection" ALTER COLUMN "connectorKey" SET NOT NULL;
ALTER TABLE "SocialAppConfig" ADD COLUMN "connectorKey" TEXT;
UPDATE "SocialAppConfig" SET "connectorKey" = CASE WHEN "network"::text = 'X' THEN 'x' ELSE lower("network"::text) END;
ALTER TABLE "SocialAppConfig" ALTER COLUMN "connectorKey" SET NOT NULL;
ALTER TABLE "OAuthPending" ADD COLUMN "connectorKey" TEXT;
UPDATE "OAuthPending" SET "connectorKey" = CASE WHEN "network"::text = 'X' THEN 'x' ELSE lower("network"::text) END;
DELETE FROM "OAuthPending" WHERE "connectorKey" IS NULL;
ALTER TABLE "OAuthPending" ALTER COLUMN "connectorKey" SET NOT NULL;

DROP INDEX "SocialConnection_orgId_network_externalAccountId_key";
CREATE UNIQUE INDEX "SocialConnection_orgId_connectorKey_externalAccountId_key" ON "SocialConnection"("orgId","connectorKey","externalAccountId");
DROP INDEX "SocialAppConfig_orgId_network_key";
CREATE UNIQUE INDEX "SocialAppConfig_orgId_connectorKey_key" ON "SocialAppConfig"("orgId","connectorKey");

ALTER TABLE "SocialConnection" DROP COLUMN "network";
ALTER TABLE "SocialAppConfig" DROP COLUMN "network";
ALTER TABLE "OAuthPending" DROP COLUMN "network";
DROP TYPE "SocialNetwork";

-- FKs
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audience" ADD CONSTRAINT "Audience_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audience" ADD CONSTRAINT "Audience_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Audience" ADD CONSTRAINT "Audience_sourceListId_fkey" FOREIGN KEY ("sourceListId") REFERENCES "MailingList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Audience" ADD CONSTRAINT "Audience_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudienceMember" ADD CONSTRAINT "AudienceMember_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceMember" ADD CONSTRAINT "AudienceMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignFlight" ADD CONSTRAINT "CampaignFlight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignFlight" ADD CONSTRAINT "CampaignFlight_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignFlight" ADD CONSTRAINT "CampaignFlight_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignFlight" ADD CONSTRAINT "CampaignFlight_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConnectorTemplate" ADD CONSTRAINT "ConnectorTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mediaChannelId_fkey" FOREIGN KEY ("mediaChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
