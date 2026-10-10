import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../common/types/user-payload.type';
import { WorkspaceIdDto } from '../workspaces/dto/workspace-id.dto';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { ServerIdsDto } from './dto/server-ids.dto';

@Controller('workspaces/:workspaceId/servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post()
  create(
    @User() user: JwtUserPayload,
    @Param() params: WorkspaceIdDto,
    @Body() dto: CreateServerDto,
  ) {
    return this.serversService.create(user.userId, params.workspaceId, dto);
  }

  @Get()
  findAll(@User() user: JwtUserPayload, @Param() params: WorkspaceIdDto) {
    return this.serversService.findAll(user.userId, params.workspaceId);
  }

  @Get(':serverId')
  findOne(@User() user: JwtUserPayload, @Param() params: ServerIdsDto) {
    return this.serversService.findOne(
      user.userId,
      params.workspaceId,
      params.serverId,
    );
  }
}
