-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "composition" JSONB,
ADD COLUMN     "launchedAt" TIMESTAMP(3),
ADD COLUMN     "learnedAt" TIMESTAMP(3),
ADD COLUMN     "lifecycle" "CampaignLifecycle" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "plannedAt" TIMESTAMP(3);
