-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ServerAuthType" AS ENUM ('PASSWORD', 'KEY');

-- CreateEnum
CREATE TYPE "AgentReportStatus" AS ENUM ('NOT_INSTALLED', 'FAILED', 'STALE', 'ACTIVE');

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL,
    "authType" "ServerAuthType" NOT NULL,
    "secretCipher" TEXT NOT NULL,
    "hostKeyFingerprint" TEXT,
    "status" "ServerStatus" NOT NULL DEFAULT 'PENDING',
    "dockerVersion" TEXT,
    "agentVersion" TEXT,
    "agentInstalledAt" TIMESTAMPTZ(3),
    "lastAgentStatus" "AgentReportStatus",
    "lastAgentErrorCode" TEXT,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Server_workspaceId_idx" ON "Server"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Server_workspaceId_name_key" ON "Server"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Server_workspaceId_hostKeyFingerprint_key" ON "Server"("workspaceId", "hostKeyFingerprint");

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
