-- AlterEnum
ALTER TYPE "FeatureCode" ADD VALUE 'AI_PREMIUM';

-- AlterTable
ALTER TABLE "AiModelConfig" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "requiredFeature" "FeatureCode";
