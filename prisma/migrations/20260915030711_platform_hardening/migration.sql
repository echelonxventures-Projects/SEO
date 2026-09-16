/*
  Warnings:

  - Added the required column `updatedAt` to the `ApiKey` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `BillingCycle` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Contact` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `GenerationJob` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Invitation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Membership` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `OAuthPending` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PipelineStage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `RankSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Refund` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Role` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Session` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Subscriber` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `TrackedLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `TrackingPixel` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "BillingCycle" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OAuthPending" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RankSnapshot" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TrackedLink" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TrackingPixel" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "recoveryCodesHash" TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" JSONB;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" INTEGER,
    "response" JSONB,
    "inFlight" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'zinc',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceTag" (
    "tagId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" "NoteEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceTag_pkey" PRIMARY KEY ("tagId","entityType","entityId")
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_orgId_key_key" ON "IdempotencyRecord"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_orgId_name_key" ON "Tag"("orgId", "name");

-- CreateIndex
CREATE INDEX "ResourceTag_orgId_entityType_entityId_idx" ON "ResourceTag"("orgId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceTag" ADD CONSTRAINT "ResourceTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
