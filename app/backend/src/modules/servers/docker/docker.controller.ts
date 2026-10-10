import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User } from '../../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../../common/types/user-payload.type';
import { ThrottleProfile } from '../../../common/throttle/throttle-profile.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ServerIdsDto } from '../dto/server-ids.dto';
import { ContainerActionDto } from './dto/container-action.dto';
import { ContainerIdsDto } from './dto/container-ids.dto';
import { ContainerLogQueryDto } from './dto/container-log-query.dto';
import { ContainersQueryDto } from './dto/containers-query.dto';
import { DockerService } from './docker.service';

/**
 * Чтения идут в профиле dockerReads, restart — в sshOps: оба стоят SSH-канал к
 * хосту клиента, и writes не должны съедать бюджет чтений (и наоборот).
 */
@Controller('workspaces/:workspaceId/servers/:serverId/docker')
@UseGuards(JwtAuthGuard)
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  @Get('containers')
  @ThrottleProfile('dockerReads')
  list(
    @User() user: JwtUserPayload,
    @Param() params: ServerIdsDto,
    @Query() query: ContainersQueryDto,
  ) {
    return this.dockerService.list(
      user.userId,
      params.workspaceId,
      params.serverId,
      query.all === 'true',
    );
  }

  @Get('containers/:containerId')
  @ThrottleProfile('dockerReads')
  details(@User() user: JwtUserPayload, @Param() params: ContainerIdsDto) {
    return this.dockerService.details(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
    );
  }

  @Get('containers/:containerId/logs')
  @ThrottleProfile('dockerReads')
  logs(
    @User() user: JwtUserPayload,
    @Param() params: ContainerIdsDto,
    @Query() query: ContainerLogQueryDto,
  ) {
    return this.dockerService.logs(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
      query,
    );
  }

  @Get('containers/:containerId/stats')
  @ThrottleProfile('dockerReads')
  stats(@User() user: JwtUserPayload, @Param() params: ContainerIdsDto) {
    return this.dockerService.stats(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
    );
  }

  @Patch('containers/:containerId')
  @ThrottleProfile('sshOps')
  act(
    @User() user: JwtUserPayload,
    @Param() params: ContainerIdsDto,
    @Body() dto: ContainerActionDto,
  ) {
    return this.dockerService.act(
      user.userId,
      params.workspaceId,
      params.serverId,
      params.containerId,
      dto,
    );
  }
}
