import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottleProfile } from '../../common/throttle/throttle-profile.decorator';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  MinRole,
  WorkspaceRoleGuard,
} from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { DeploymentIdsDto } from './dto/deployment-ids.dto';
import { ListDeploymentsQueryDto } from './dto/list-deployments-query.dto';

@Controller('workspaces/:workspaceId/deployments')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post()
  @HttpCode(202)
  @ThrottleProfile('sshOps')
  @MinRole(WorkspaceRole.OWNER)
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateDeploymentDto,
  ) {
    return this.deploymentsService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  @MinRole(WorkspaceRole.MEMBER)
  list(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Query() query: ListDeploymentsQueryDto,
  ) {
    return this.deploymentsService.findAll(
      user.userId,
      params.workspaceId,
      query,
    );
  }
}

@Controller('deployments')
@UseGuards(JwtAuthGuard)
export class DeploymentController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Get(':deploymentId')
  one(@User() user: JwtUserPayload, @Param() params: DeploymentIdsDto) {
    return this.deploymentsService.findOne(user.userId, params.deploymentId);
  }

  @Get(':deploymentId/logs')
  logs(@User() user: JwtUserPayload, @Param() params: DeploymentIdsDto) {
    return this.deploymentsService.logs(user.userId, params.deploymentId);
  }
}
