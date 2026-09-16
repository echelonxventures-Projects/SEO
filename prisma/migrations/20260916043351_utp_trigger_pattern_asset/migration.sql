-- AlterTable
ALTER TABLE "TemporalTrigger" ADD COLUMN     "patternId" TEXT;

-- AddForeignKey
ALTER TABLE "TemporalTrigger" ADD CONSTRAINT "TemporalTrigger_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
