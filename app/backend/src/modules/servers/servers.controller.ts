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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  MinRole,
  WorkspaceRoleGuard,
} from '../../common/guards/workspace-role.guard';
import { WorkspaceRole } from '@prisma/client';
import { ThrottleProfile } from '../../common/throttle/throttle-profile.decorator';
import { CursorPaginationDto } from '../../common/dto/cursor-pagination.dto';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { ServersService } from './servers.service';
import { AgentService } from './agent.service';
import { CreateServerDto } from './dto/create-server.dto';
import { ServerIdsDto } from './dto/server-ids.dto';
import { TestServerDto } from './dto/test-server.dto';

@Controller('workspaces/:workspaceId/servers')
@UseGuards(JwtAuthGuard, WorkspaceRoleGuard)
export class ServersController {
  constructor(
    private readonly serversService: ServersService,
    private readonly agentService: AgentService,
  ) {}

  @Post()
  @MinRole(WorkspaceRole.OWNER)
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateServerDto,
  ) {
    return this.serversService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  @MinRole(WorkspaceRole.MEMBER)
  findAll(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Query() q: CursorPaginationDto,
  ) {
    return this.serversService.findAll(user.userId, params.workspaceId, q);
  }

  @Get(':serverId')
  @MinRole(WorkspaceRole.MEMBER)
  findOne(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
    return this.serversService.findOne(
      user.userId,
      params.workspaceId,
      params.serverId,
    );
  }

  @Post(':serverId/test')
  @HttpCode(200)
  @ThrottleProfile('sshOps')
  @MinRole(WorkspaceRole.MEMBER)
  test(
    @User() user: JwtUserPayload,
    @Param() params: ServerIdsDto,
    @Body() dto: TestServerDto,
  ) {
    return this.serversService.testConnection(
      user.userId,
      params.workspaceId,
      params.serverId,
      dto,
    );
  }

  @Post(':serverId/agent/install')
  @ThrottleProfile('sshOps')
  @MinRole(WorkspaceRole.OWNER)
  installAgent(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
    return this.agentService.install(
      user.userId,
      params.workspaceId,
      params.serverId,
    );
  }

  @Get(':serverId/agent')
  @ThrottleProfile('sshOps')
  @MinRole(WorkspaceRole.MEMBER)
  agent(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
    return this.agentService.status(
      user.userId,
      params.workspaceId,
      params.serverId,
    );
  }
}
