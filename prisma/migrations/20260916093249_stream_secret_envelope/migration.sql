/*
  Warnings:

  - Changed the type of `secretEnc` on the `StreamTransport` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "StreamTransport" DROP COLUMN "secretEnc",
ADD COLUMN     "secretEnc" JSONB NOT NULL;
