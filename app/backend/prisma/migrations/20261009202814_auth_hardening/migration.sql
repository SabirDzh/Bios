/*
  Warnings:

  - Added the required column `expiresAt` to the `Token` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "RefreshSession_familyId_idx";

-- DropIndex
DROP INDEX "RefreshSession_userId_idx";

-- AlterTable
ALTER TABLE "RefreshSession" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "usedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "revokedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "expiresAt" TIMESTAMPTZ(3) NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_status_idx" ON "RefreshSession"("familyId", "status");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_status_idx" ON "RefreshSession"("userId", "status");

-- CreateIndex
CREATE INDEX "Token_userId_type_idx" ON "Token"("userId", "type");

-- CreateIndex
CREATE INDEX "Token_expiresAt_idx" ON "Token"("expiresAt");
