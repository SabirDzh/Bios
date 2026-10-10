import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { User } from '../../../common/decorators/user.decorator';
import type { JwtUserPayload } from '../../../common/types/user-payload.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ServerIdsDto } from '../dto/server-ids.dto';
import { ContainersQueryDto } from './dto/containers-query.dto';
import { DockerService } from './docker.service';

@Controller('workspaces/:workspaceId/servers/:serverId/docker')
@UseGuards(JwtAuthGuard)
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  // Профиль троттлинга для чтений Docker появится вместе с dockerReads (Task 4);
  // пока роут охраняется global-профилем, а не остаётся без guard'а.
  @Get('containers')
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
}
