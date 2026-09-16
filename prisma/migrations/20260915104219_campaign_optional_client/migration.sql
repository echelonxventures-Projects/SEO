-- DropForeignKey
ALTER TABLE "Audience" DROP CONSTRAINT "Audience_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_channelId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_clientId_fkey";

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AudienceMember" ALTER COLUMN "tags" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BillingCycle" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Channel" ALTER COLUMN "capabilities" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConnectorTemplate" ALTER COLUMN "capabilities" DROP DEFAULT,
ALTER COLUMN "scopes" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GenerationJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Invitation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Membership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OAuthPending" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PipelineStage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RankSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Refund" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Subscriber" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrackedLink" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrackingPixel" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
