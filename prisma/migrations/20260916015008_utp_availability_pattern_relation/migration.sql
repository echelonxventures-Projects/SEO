-- AddForeignKey
ALTER TABLE "AvailabilityProfile" ADD CONSTRAINT "AvailabilityProfile_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
