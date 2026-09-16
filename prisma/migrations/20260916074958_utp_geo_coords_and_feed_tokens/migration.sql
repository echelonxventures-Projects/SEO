-- AlterTable
ALTER TABLE "Calendar" ADD COLUMN     "shareTokens" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "GeoLocation" ADD COLUMN     "latE7" INTEGER,
ADD COLUMN     "lngE7" INTEGER;
