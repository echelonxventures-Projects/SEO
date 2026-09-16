-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FREE', 'ONE_TIME', 'SUBSCRIPTION', 'USAGE', 'REVENUE_SHARE', 'ENTERPRISE_CONTRACT');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('UNCERTIFIED', 'PENDING', 'CERTIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WidgetKind" AS ENUM ('BOOKING', 'AVAILABILITY', 'APPOINTMENT', 'SCHEDULING', 'CALENDAR');

-- CreateEnum
CREATE TYPE "CalendarConnectorProtocol" AS ENUM ('GOOGLE_CALENDAR', 'MICROSOFT_GRAPH', 'CALDAV', 'ICAL_SUBSCRIBE', 'GENERIC_REST');

-- CreateEnum
CREATE TYPE "CalendarSyncDirection" AS ENUM ('PULL', 'PUSH', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('APPOINTMENT', 'SCHEDULE', 'TRIGGER', 'EXECUTION', 'RESOURCE_HOUR', 'API_CALL', 'WIDGET_VIEW', 'MARKETPLACE_INSTALL', 'ACTIVE_SEAT', 'STORAGE_EVENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LibraryTemplateKind" ADD VALUE 'BOOKING';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'WORKFLOW';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'AUTOMATION';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'COMPLIANCE';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'LAUNCH';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'SUPPORT_WINDOW';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'PEAK_WINDOW';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'CAPACITY_MODEL';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'AVAILABILITY_MODEL';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'AI_TEMPLATE';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'DEPARTMENT';
ALTER TYPE "LibraryTemplateKind" ADD VALUE 'RESOURCE_TEMPLATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransportKind" ADD VALUE 'KAFKA';
ALTER TYPE "TransportKind" ADD VALUE 'PULSAR';
ALTER TYPE "TransportKind" ADD VALUE 'EVENT_MESH';

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "publisherName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assetKind" "LibraryTemplateKind" NOT NULL DEFAULT 'ENTERPRISE',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "bundle" JSONB NOT NULL DEFAULT '{}',
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'FREE',
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "revenueShareBps" INTEGER NOT NULL DEFAULT 0,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "certification" "CertificationStatus" NOT NULL DEFAULT 'UNCERTIFIED',
    "certifiedAt" TIMESTAMP(3),
    "certifyNote" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "ratingBps" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceInstall" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "installerOrgId" TEXT NOT NULL,
    "installedById" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdIds" JSONB NOT NULL DEFAULT '{}',
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "revenueShareMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetEmbed" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WidgetKind" NOT NULL DEFAULT 'BOOKING',
    "token" TEXT NOT NULL,
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "behavior" JSONB NOT NULL DEFAULT '{}',
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnectorTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" "CalendarConnectorProtocol" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnectorTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT,
    "direction" "CalendarSyncDirection" NOT NULL DEFAULT 'BIDIRECTIONAL',
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "credentialsEnc" JSONB NOT NULL DEFAULT '{}',
    "syncToken" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "billedCycleId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanMeteredPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "includedQty" INTEGER NOT NULL DEFAULT 0,
    "priceMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanMeteredPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgBranding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT 'OmniMark',
    "tagline" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#6366f1',
    "accentColor" TEXT NOT NULL DEFAULT '#22c55e',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "loginBackgroundUrl" TEXT,
    "customDomain" TEXT,
    "emailFromName" TEXT,
    "emailFromAddress" TEXT,
    "hidePoweredBy" BOOLEAN NOT NULL DEFAULT false,
    "oem" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "translations" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocaleCatalog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'ltr',
    "strings" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocaleCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_assetKind_idx" ON "MarketplaceListing"("status", "assetKind");

-- CreateIndex
CREATE INDEX "MarketplaceListing_certification_idx" ON "MarketplaceListing"("certification");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_orgId_code_version_key" ON "MarketplaceListing"("orgId", "code", "version");

-- CreateIndex
CREATE INDEX "MarketplaceInstall_installerOrgId_idx" ON "MarketplaceInstall"("installerOrgId");

-- CreateIndex
CREATE INDEX "MarketplaceInstall_listingId_idx" ON "MarketplaceInstall"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetEmbed_token_key" ON "WidgetEmbed"("token");

-- CreateIndex
CREATE INDEX "WidgetEmbed_orgId_kind_active_idx" ON "WidgetEmbed"("orgId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnectorTemplate_orgId_key_key" ON "CalendarConnectorTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "CalendarConnection_orgId_status_idx" ON "CalendarConnection"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_calendarId_templateId_externalId_key" ON "CalendarConnection"("calendarId", "templateId", "externalId");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_metric_at_idx" ON "UsageEvent"("orgId", "metric", "at");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_billed_idx" ON "UsageEvent"("orgId", "billed");

-- CreateIndex
CREATE UNIQUE INDEX "PlanMeteredPrice_planId_metric_key" ON "PlanMeteredPrice"("planId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBranding_orgId_key" ON "OrgBranding"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBranding_customDomain_key" ON "OrgBranding"("customDomain");

-- CreateIndex
CREATE INDEX "LocaleCatalog_active_idx" ON "LocaleCatalog"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LocaleCatalog_orgId_code_key" ON "LocaleCatalog"("orgId", "code");

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceInstall" ADD CONSTRAINT "MarketplaceInstall_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetEmbed" ADD CONSTRAINT "WidgetEmbed_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetEmbed" ADD CONSTRAINT "WidgetEmbed_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnectorTemplate" ADD CONSTRAINT "CalendarConnectorTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CalendarConnectorTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanMeteredPrice" ADD CONSTRAINT "PlanMeteredPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgBranding" ADD CONSTRAINT "OrgBranding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocaleCatalog" ADD CONSTRAINT "LocaleCatalog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
