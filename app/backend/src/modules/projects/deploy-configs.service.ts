import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeployConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  SUPPORTED_METHODS,
  type CreateDeployConfigDto,
} from './dto/create-deploy-config.dto';
import {
  assertContainerName,
  assertGitRef,
  assertPortMappings,
  assertRelativeFilePath,
  type DeployConfigResponse,
} from './project.types';
import { ProjectsService } from './projects.service';

function toResponse(row: DeployConfig): DeployConfigResponse {
  return {
    id: row.id,
    projectId: row.projectId,
    serverId: row.serverId,
    name: row.name,
    // Метод сужен DTO на create; приведение держит тип ответа узким —
    // исполнитель среза 1 знает один метод.
    method: row.method as 'GIT_PULL',
    ref: row.ref,
    dockerfile: row.dockerfile,
    containerName: row.containerName,
    ports: row.ports,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class DeployConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Граница данных, а не только HTTP: DTO (`@IsIn`) отсекает мусор на маршруте,
   * но сервис могут вызвать в обход ValidationPipe — тест и сид Task 6 именно
   * так и делают. Прецедент в репозитории — `UsersService.create`, который
   * нормализует email повторно по той же причине.
   */
  async create(
    userId: string,
    workspaceId: string,
    projectId: string,
    dto: CreateDeployConfigDto,
  ): Promise<DeployConfigResponse> {
    if (!SUPPORTED_METHODS.includes(dto.method)) {
      throw new BadRequestException(
        `method must be GIT_PULL (${dto.method} — следующий срез)`,
      );
    }
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );
    const project = await this.projects.requireRow(projectId, workspaceId);

    // Чужой или несуществующий сервер — 404 одинаково: неотличимость как в
    // `requireRow` серверов (часть 3), а не «400, у меня нет такого id».
    const server = await this.prisma.server.findFirst({
      where: { id: dto.serverId, workspaceId },
    });
    if (!server) throw new NotFoundException('server not found');

    try {
      return toResponse(
        await this.prisma.deployConfig.create({
          data: {
            projectId: project.id,
            serverId: server.id,
            name: dto.name.trim(),
            method: dto.method,
            ref: assertGitRef(dto.ref),
            dockerfile: assertRelativeFilePath(dto.dockerfile ?? 'Dockerfile'),
            containerName: assertContainerName(dto.containerName),
            ports: assertPortMappings(dto.ports),
          },
        }),
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'deploy config name exists in this project, or containerName is already used on this server',
        );
      }
      throw err;
    }
  }

  async findAll(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<DeployConfigResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const project = await this.projects.requireRow(projectId, workspaceId);
    const rows = await this.prisma.deployConfig.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  /** Исполнителю (Task 6) нужна строка целиком, включая `serverId`. */
  async requireRow(configId: string, projectId: string): Promise<DeployConfig> {
    const row = await this.prisma.deployConfig.findFirst({
      where: { id: configId, projectId },
    });
    if (!row) throw new NotFoundException('deploy config not found');
    return row;
  }
}
