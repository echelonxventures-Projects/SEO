-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('DISCOUNT', 'COUPON', 'PROMOTION', 'BUNDLE', 'REFERRAL', 'LOYALTY', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "OfferValueType" AS ENUM ('PERCENT', 'AMOUNT', 'FREE_ITEM', 'POINTS');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'ACTIVE', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignLifecycle" AS ENUM ('DRAFT', 'PLANNED', 'PENDING_APPROVAL', 'APPROVED', 'LIVE', 'CLOSED', 'LEARNED');

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSubscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "eventMatch" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "secretEnc" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "OfferKind" NOT NULL DEFAULT 'COUPON',
    "valueType" "OfferValueType" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "minSpendMinor" BIGINT,
    "maxRedemptions" INTEGER,
    "perRecipientLimit" INTEGER DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "appliesTo" JSONB,
    "terms" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "email" TEXT,
    "clientId" TEXT,
    "invoiceId" TEXT,
    "campaignId" TEXT,
    "discountMinor" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignOffer" (
    "campaignId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignOffer_pkey" PRIMARY KEY ("campaignId","offerId")
);

-- CreateTable
CREATE TABLE "LearningsSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "learnings" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_type_occurredAt_idx" ON "DomainEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_orgId_occurredAt_idx" ON "DomainEvent"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEvent_deletedAt_idx" ON "DomainEvent"("deletedAt");

-- CreateIndex
CREATE INDEX "EventSubscription_active_idx" ON "EventSubscription"("active");

-- CreateIndex
CREATE INDEX "EventDelivery_status_at_idx" ON "EventDelivery"("status", "at");

-- CreateIndex
CREATE UNIQUE INDEX "EventDelivery_eventId_subscriptionId_key" ON "EventDelivery"("eventId", "subscriptionId");

-- CreateIndex
CREATE INDEX "Offer_orgId_status_idx" ON "Offer"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_orgId_code_key" ON "Offer"("orgId", "code");

-- CreateIndex
CREATE INDEX "OfferRedemption_offerId_recipientKey_idx" ON "OfferRedemption"("offerId", "recipientKey");

-- CreateIndex
CREATE UNIQUE INDEX "LearningsSnapshot_campaignId_key" ON "LearningsSnapshot"("campaignId");

-- AddForeignKey
ALTER TABLE "EventSubscription" ADD CONSTRAINT "EventSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDelivery" ADD CONSTRAINT "EventDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "EventSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignOffer" ADD CONSTRAINT "CampaignOffer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignOffer" ADD CONSTRAINT "CampaignOffer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningsSnapshot" ADD CONSTRAINT "LearningsSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
