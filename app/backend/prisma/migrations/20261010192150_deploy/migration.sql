-- CreateEnum
CREATE TYPE "DeployMethod" AS ENUM ('GIT_PULL', 'COMPOSE', 'SHELL_SCRIPT', 'CUSTOM_COMMANDS');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "DeployStepName" AS ENUM ('PREFLIGHT', 'SOURCE', 'BUILD', 'RUN');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeployConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" "DeployMethod" NOT NULL DEFAULT 'GIT_PULL',
    "ref" TEXT NOT NULL,
    "dockerfile" TEXT NOT NULL DEFAULT 'Dockerfile',
    "containerName" TEXT NOT NULL,
    "ports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serverId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeployConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "triggeredById" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'QUEUED',
    "step" "DeployStepName",
    "log" TEXT NOT NULL DEFAULT '',
    "imageTag" TEXT,
    "commitSha" TEXT,
    "containerId" TEXT,
    "errorCode" TEXT,
    "exitCode" INTEGER,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "snapshot" JSONB,
    "activeConfigId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_name_key" ON "Project"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "DeployConfig_serverId_idx" ON "DeployConfig"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "DeployConfig_projectId_name_key" ON "DeployConfig"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DeployConfig_serverId_containerName_key" ON "DeployConfig"("serverId", "containerName");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_activeConfigId_key" ON "Deployment"("activeConfigId");

-- CreateIndex
CREATE INDEX "Deployment_projectId_createdAt_idx" ON "Deployment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_configId_createdAt_idx" ON "Deployment"("configId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeployConfig" ADD CONSTRAINT "DeployConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeployConfig" ADD CONSTRAINT "DeployConfig_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_configId_fkey" FOREIGN KEY ("configId") REFERENCES "DeployConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
