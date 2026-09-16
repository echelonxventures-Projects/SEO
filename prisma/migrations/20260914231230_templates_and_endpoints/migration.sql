-- AlterTable
ALTER TABLE "SocialAppConfig" ADD COLUMN     "apiBase" TEXT,
ADD COLUMN     "authorizeUrl" TEXT,
ADD COLUMN     "extraHeaders" JSONB,
ADD COLUMN     "tokenUrl" TEXT;

-- AlterTable
ALTER TABLE "TrackingPixel" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "PixelTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "placement" "PixelPlacement" NOT NULL DEFAULT 'HEAD',
    "docUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PixelTemplate_active_idx" ON "PixelTemplate"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PixelTemplate_orgId_key_key" ON "PixelTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "TrackingPixel_templateId_idx" ON "TrackingPixel"("templateId");

-- AddForeignKey
ALTER TABLE "TrackingPixel" ADD CONSTRAINT "TrackingPixel_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PixelTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixelTemplate" ADD CONSTRAINT "PixelTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
