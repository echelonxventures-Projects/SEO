-- AlterTable
ALTER TABLE "CampaignFlight" ADD COLUMN     "patternId" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "lastScheduledAt" TIMESTAMP(3),
ADD COLUMN     "nextScheduledAt" TIMESTAMP(3),
ADD COLUMN     "patternId" TEXT;

-- CreateIndex
CREATE INDEX "Report_nextScheduledAt_idx" ON "Report"("nextScheduledAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFlight" ADD CONSTRAINT "CampaignFlight_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
