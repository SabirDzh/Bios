import { Controller, Get, Param } from '@nestjs/common';
import { DockerService } from './docker.service';

@Controller('workspaces/:workspaceId/servers/:serverId/docker')
export class DockerController {
  constructor(private readonly dockerService: DockerService) {}

  @Get('containers')
  findContainers(
    @Param('workspaceId') workspaceId: string,
    @Param('serverId') serverId: string,
  ) {
    return this.dockerService.findContainers(workspaceId, serverId);
  }
}
