import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Deployment, DeploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DeployConfigsService } from '../projects/deploy-configs.service';
import { ProjectsService } from '../projects/projects.service';
import type { CreateDeploymentDto } from './dto/create-deployment.dto';
import type { ListDeploymentsQueryDto } from './dto/list-deployments-query.dto';
import { DeployRunnerService } from './deploy-runner.service';
import type {
  DeployErrorCode,
  DeployStepName,
  DeploymentLogsResponse,
  DeploymentResponse,
} from './deployment.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const FINISHED: DeploymentStatus[] = [
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.INTERRUPTED,
];

function toResponse(row: Deployment): DeploymentResponse {
  return {
    id: row.id,
    projectId: row.projectId,
    configId: row.configId,
    status: row.status,
    // Протокол lowercase (`preflight`), БД — enum (`PREFLIGHT`): обратная
    // конверсия к `toPrismaStep` из Task 6, проверяется тестом findOne.
    step: row.step ? (row.step.toLowerCase() as DeployStepName) : null,
    imageTag: row.imageTag,
    commitSha: row.commitSha,
    containerId: row.containerId,
    // errorCode в БД — свободная строка (Task 1), словарь живёт в TypeScript
    errorCode: row.errorCode as DeployErrorCode | null,
    exitCode: row.exitCode,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    triggeredById: row.triggeredById,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projects: ProjectsService,
    private readonly configs: DeployConfigsService,
    private readonly runner: DeployRunnerService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateDeploymentDto,
  ): Promise<DeploymentResponse> {
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );
    const project = await this.projects.requireRow(dto.projectId, workspaceId);
    const config = await this.configs.requireRow(dto.configId, project.id);

    let row: Deployment;
    try {
      row = await this.prisma.deployment.create({
        data: {
          projectId: project.id,
          configId: config.id,
          triggeredById: userId,
          // Уникальный activeConfigId и есть очередь «одна активная задача на
          // конфигурацию»: вставка либо занимает слот, либо даёт P2002.
          activeConfigId: config.id,
          // Снимок — контракт исполнения: исполнитель строит план из него,
          // поэтому сюда попадает всё, что уходит в shell.
          snapshot: {
            method: config.method,
            ref: config.ref,
            dockerfile: config.dockerfile,
            containerName: config.containerName,
            ports: config.ports,
            repoUrl: project.repoUrl,
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'a deployment for this config is already queued or running',
        );
      }
      throw err;
    }

    // Задача уже видна очереди (вставка завершилась), поэтому мы не передаём id:
    // исполнитель сам возьмёт самую старую QUEUED в пределах свободных слотов.
    // `pump` не бросает наружу (Task 6).
    this.runner.pump();
    return toResponse(row);
  }

  async findAll(
    userId: string,
    workspaceId: string,
    query: ListDeploymentsQueryDto,
  ): Promise<DeploymentResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    // `limit` уже проверен регуляркой на границе (1..100); `Math.min` здесь
    // только на случай прямого вызова сервиса из другого кода
    const take = Math.min(Number(query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const rows = await this.prisma.deployment.findMany({
      where: {
        project: { workspaceId },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.configId ? { configId: query.configId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map(toResponse);
  }

  async findOne(
    userId: string,
    deploymentId: string,
  ): Promise<DeploymentResponse> {
    return toResponse(await this.scoped(userId, deploymentId));
  }

  async logs(
    userId: string,
    deploymentId: string,
  ): Promise<DeploymentLogsResponse> {
    const row = await this.scoped(userId, deploymentId);
    return {
      deploymentId: row.id,
      status: row.status,
      finished: FINISHED.includes(row.status),
      log: row.log,
      sizeBytes: Buffer.byteLength(row.log, 'utf8'),
    };
  }

  /**
   * Плоский маршрут: воркспейс известен только из самой строки, поэтому порядок
   * такой — прочитать, проверить членство, отдать. 403 от `requireMembership`
   * гасится в 404: он подтвердил бы, что чужая задача существует.
   */
  private async scoped(
    userId: string,
    deploymentId: string,
  ): Promise<Deployment & { project: { workspaceId: string } }> {
    const row = await this.prisma.deployment.findFirst({
      where: { id: deploymentId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!row) throw new NotFoundException('deployment not found');
    try {
      await this.workspaces.requireMembership(
        userId,
        row.project.workspaceId,
        MEMBER_ROLES,
      );
    } catch (err) {
      if (
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        throw new NotFoundException('deployment not found');
      }
      throw err;
    }
    return row;
  }
}
