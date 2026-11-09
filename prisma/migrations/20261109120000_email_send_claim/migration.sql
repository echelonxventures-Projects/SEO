-- Dispatcher lease so overlapping runs cannot deliver the same send twice.
ALTER TABLE "EmailSend" ADD COLUMN "claimedAt" TIMESTAMP(3);
