import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { MEMBER_ROLES, OWNER_ONLY_ROLES } from '../servers/servers.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import {
  assertPublicHttpsRepoUrl,
  type ProjectResponse,
} from './project.types';

function toResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectResponse> {
    await this.workspaces.requireMembership(
      userId,
      workspaceId,
      OWNER_ONLY_ROLES,
    );
    const repoUrl = assertPublicHttpsRepoUrl(dto.repoUrl);
    try {
      return toResponse(
        await this.prisma.project.create({
          data: { workspaceId, name: dto.name.trim(), repoUrl },
        }),
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('project name already exists');
      }
      throw err;
    }
  }

  async findAll(
    userId: string,
    workspaceId: string,
  ): Promise<ProjectResponse[]> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  async findOne(
    userId: string,
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectResponse> {
    await this.workspaces.requireMembership(userId, workspaceId, MEMBER_ROLES);
    return toResponse(await this.requireRow(projectId, workspaceId));
  }

  /**
   * 404, а не 403: чужой проект неотличим от несуществующего — то же правило,
   * что `requireRow` в servers.service.ts (часть 3).
   */
  async requireRow(projectId: string, workspaceId: string): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) throw new NotFoundException('project not found');
    return project;
  }
}
