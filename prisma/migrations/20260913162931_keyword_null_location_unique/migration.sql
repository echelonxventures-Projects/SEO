-- Enforce uniqueness of a keyword when no location is set.
-- Prisma's @@unique treats NULL locationId as non-equal, so two NULL-location
-- keywords for the same org/term/device could be created. This partial index closes that gap.
CREATE UNIQUE INDEX IF NOT EXISTS "Keyword_orgId_normalized_device_null_loc_key"
  ON "Keyword" ("orgId", "normalized", "device")
  WHERE "locationId" IS NULL;
