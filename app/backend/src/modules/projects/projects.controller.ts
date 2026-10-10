import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { DeployConfigsService } from './deploy-configs.service';
import { CreateDeployConfigDto } from './dto/create-deploy-config.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectIdsDto } from './dto/project-ids.dto';
import { ProjectsService } from './projects.service';

@Controller('workspaces/:workspaceId/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly deployConfigsService: DeployConfigsService,
  ) {}

  @Post()
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  list(@User() user: JwtUserPayload, @Param() params: WorkspaceIdDto) {
    return this.projectsService.findAll(user.userId, params.workspaceId);
  }

  @Get(':projectId')
  one(@User() user: JwtUserPayload, @Param() params: ProjectIdsDto) {
    return this.projectsService.findOne(
      user.userId,
      params.workspaceId,
      params.projectId,
    );
  }

  @Post(':projectId/deploy-configs')
  createConfig(
    @User() user: JwtUserPayload,
    @Param() params: ProjectIdsDto,
    @Body() dto: CreateDeployConfigDto,
  ) {
    return this.deployConfigsService.create(
      user.userId,
      params.workspaceId,
      params.projectId,
      dto,
    );
  }

  @Get(':projectId/deploy-configs')
  listConfigs(@User() user: JwtUserPayload, @Param() params: ProjectIdsDto) {
    return this.deployConfigsService.findAll(
      user.userId,
      params.workspaceId,
      params.projectId,
    );
  }
}
