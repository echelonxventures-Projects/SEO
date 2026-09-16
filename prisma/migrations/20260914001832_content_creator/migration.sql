-- CreateEnum
CREATE TYPE "PublishSource" AS ENUM ('MANUAL', 'STUDIO');

-- AlterTable
ALTER TABLE "ContentPost" ADD COLUMN     "source" "PublishSource" NOT NULL DEFAULT 'MANUAL';

-- AddForeignKey
ALTER TABLE "ContentPost" ADD CONSTRAINT "ContentPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
