-- CreateEnum
CREATE TYPE "TransportKind" AS ENUM ('HTTP_SINK');

-- CreateTable
CREATE TABLE "StreamTransport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "TransportKind" NOT NULL DEFAULT 'HTTP_SINK',
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "eventMatch" TEXT NOT NULL DEFAULT '*',
    "cursorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursorId" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamTransport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StreamTransport_active_idx" ON "StreamTransport"("active");

-- CreateIndex
CREATE UNIQUE INDEX "StreamTransport_orgId_name_key" ON "StreamTransport"("orgId", "name");

-- AddForeignKey
ALTER TABLE "StreamTransport" ADD CONSTRAINT "StreamTransport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
